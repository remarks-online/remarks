import type { AnnotationIntent, AnnotationSeverity } from "@remarks/shared";
import type { Capture } from "./picker-store";
import type { UploadStep } from "./upload-annotation";

export type OutboxState = "pending" | "error";

export interface OutboxRecordError {
  step: UploadStep;
  message: string;
  status: number | null;
}

// Exactly the data needed to reconstruct an `UploadAnnotationInput` at drain
// time — `token` and `apiUrl` are resolved fresh so expired bearers don't
// get persisted and so a re-deployed API URL is picked up.
//
// `intent` / `severity` are optional because (a) most captures don't classify
// at create time (uncategorized is the default) and (b) records enqueued
// before this field was added drain fine without them — `CreateAnnotationRequest`
// accepts both as optional.
export interface OutboxPayload {
  // Null when the enqueued record is a personal (URL-keyed) annotation.
  branch: string | null;
  capture: Capture;
  commentText: string;
  intent?: AnnotationIntent | null;
  severity?: AnnotationSeverity | null;
}

export interface OutboxRecord {
  // Client-side uuid, *not* the server annotation id. Stable across retries.
  id: string;
  // Active Clerk org at enqueue time — used so an org-switch mid-flight
  // doesn't drain records belonging to the previous org.
  clerkOrgId: string | null;
  // Null for personal (URL-keyed) annotations; the project id otherwise.
  projectId: string | null;
  payload: OutboxPayload;
  state: OutboxState;
  attempts: number;
  lastError: OutboxRecordError | null;
  createdAt: number;
  lastAttemptAt: number | null;
  // Eligible for the next drain tick when Date.now() >= nextAttemptAt.
  nextAttemptAt: number;
}

const DB_NAME = "remarks-outbox";
const DB_VERSION = 1;
const STORE = "outbox";
const INDEX_NEXT_ATTEMPT = "byNextAttemptAt";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex(INDEX_NEXT_ATTEMPT, "nextAttemptAt", { unique: false });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        // Another tab upgraded the schema — close so the upgrade can proceed.
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error("outbox_open_failed"));
    req.onblocked = () => reject(new Error("outbox_open_blocked"));
  });
  return dbPromise;
}

async function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T> | T
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    let result: T;
    Promise.resolve(run(store))
      .then((value) => {
        result = value;
      })
      .catch(reject);
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error ?? new Error("outbox_tx_failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("outbox_tx_aborted"));
  });
}

function toPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("outbox_request_failed"));
  });
}

export interface EnqueueArgs {
  id: string;
  clerkOrgId: string | null;
  // Null for personal (URL-keyed) annotations; the project id otherwise.
  projectId: string | null;
  payload: OutboxPayload;
  now?: number;
}

export async function enqueue(args: EnqueueArgs): Promise<OutboxRecord> {
  const now = args.now ?? Date.now();
  const record: OutboxRecord = {
    id: args.id,
    clerkOrgId: args.clerkOrgId,
    projectId: args.projectId,
    payload: args.payload,
    state: "pending",
    attempts: 0,
    lastError: null,
    createdAt: now,
    lastAttemptAt: null,
    nextAttemptAt: now,
  };
  await tx("readwrite", (store) => toPromise(store.put(record)));
  return record;
}

export async function listAll(): Promise<OutboxRecord[]> {
  return tx("readonly", (store) => toPromise(store.getAll() as IDBRequest<OutboxRecord[]>));
}

export async function getOne(id: string): Promise<OutboxRecord | null> {
  return tx("readonly", async (store) => {
    const value = await toPromise(store.get(id) as IDBRequest<OutboxRecord | undefined>);
    return value ?? null;
  });
}

export async function update(record: OutboxRecord): Promise<void> {
  await tx("readwrite", (store) => toPromise(store.put(record)));
}

export async function remove(id: string): Promise<void> {
  await tx("readwrite", (store) => toPromise(store.delete(id)));
}

export async function requeue(id: string, now: number = Date.now()): Promise<OutboxRecord | null> {
  return tx("readwrite", async (store) => {
    const existing = await toPromise(store.get(id) as IDBRequest<OutboxRecord | undefined>);
    if (!existing) return null;
    const next: OutboxRecord = {
      ...existing,
      state: "pending",
      attempts: 0,
      lastError: null,
      nextAttemptAt: now,
    };
    await toPromise(store.put(next));
    return next;
  });
}

// Used on sign-out and by tests that want a deterministic starting state.
export async function clear(): Promise<void> {
  await tx("readwrite", (store) => toPromise(store.clear()));
}

// Exposed for tests only. Production code should never need to close the
// singleton — it lives for the lifetime of the document.
export function __resetForTests(): void {
  dbPromise = null;
}
