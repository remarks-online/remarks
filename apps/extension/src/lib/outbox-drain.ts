// Task 1.28 offline queue — drain loop.
//
// This is the content-script-owned retry loop. The sidebar mounts it via
// use-outbox-drain.ts, and it's also invoked once, directly, right after a
// submit enqueues a new record (to try the happy path without waiting for
// the 30s interval).
//
// Multi-tab note: two tabs can race and send the same record twice. The
// server will accept both and produce duplicate annotations; we tolerate
// this in Phase 1 in exchange for a simpler implementation. A per-record
// lease field can be added later if beta users report it.

import type { AnnotationResponse } from "@remarks/shared";
import {
  type OutboxRecord,
  listAll,
  remove as removeRecord,
  update as updateRecord,
} from "./outbox-db";
import {
  UploadAnnotationError,
  type UploadAnnotationInput,
  isRetryable,
  uploadAnnotation,
} from "./upload-annotation";

// 30s per spec §6.7. No exponential backoff — the spec is explicit about the
// cadence. `DRAIN_INTERVAL_MS` is also the backoff after a single failed
// attempt so all retry timing is governed by one knob.
export const DRAIN_INTERVAL_MS = 30_000;
export const MAX_ATTEMPTS = 3;

export type DrainOutcome =
  | { id: string; kind: "ok"; annotation: AnnotationResponse }
  | { id: string; kind: "retry"; attempts: number }
  | { id: string; kind: "error"; attempts: number };

export interface DrainArgs {
  apiUrl: string;
  // Bearer token. If null, drainOutbox is a no-op — nothing to authenticate.
  token: string | null;
  // Active Clerk org at drain time. Only records whose `clerkOrgId` matches
  // or is null (legacy) are attempted; org-scoped skip avoids draining
  // records that belong to a different user/org.
  clerkOrgId: string | null;
  // Caller-supplied upload; defaults to the real `uploadAnnotation`. Injected
  // so tests can simulate success/failure without mocking fetch.
  upload?: (input: UploadAnnotationInput) => Promise<AnnotationResponse>;
  now?: () => number;
  // Called for every processed record so the caller can (a) update the
  // zustand projection, (b) invalidate React Query on success.
  onOutcome?: (outcome: DrainOutcome, record: OutboxRecord) => void;
}

/**
 * Pick every pending record whose `nextAttemptAt <= now`, try each one
 * sequentially, and mutate it in IDB based on the outcome. Returns the
 * list of outcomes in processing order.
 *
 * Sequential, not parallel: the same screenshot may be multi-MB, the
 * bearer token comes from a single Clerk session, and the server-side
 * rate limiter (§5.6) pushes back at 100 mutations/minute. One at a time
 * keeps all of those well-behaved.
 */
export async function drainOutbox(args: DrainArgs): Promise<DrainOutcome[]> {
  const outcomes: DrainOutcome[] = [];
  if (!args.token) return outcomes;

  const now = args.now ?? Date.now;
  const upload = args.upload ?? uploadAnnotation;

  const all = await listAll();
  const eligible = all.filter(
    (r) =>
      r.state === "pending" &&
      r.nextAttemptAt <= now() &&
      // Skip records from other orgs; they'll drain when the user switches
      // back and this tab's content script sees the matching org.
      (r.clerkOrgId === null || args.clerkOrgId === null || r.clerkOrgId === args.clerkOrgId)
  );

  for (const record of eligible) {
    const outcome = await processOne(record, { ...args, upload, now });
    outcomes.push(outcome);
    args.onOutcome?.(outcome, record);
  }
  return outcomes;
}

async function processOne(
  record: OutboxRecord,
  args: Required<Pick<DrainArgs, "apiUrl" | "upload" | "now">> & { token: string | null }
): Promise<DrainOutcome> {
  if (!args.token) {
    // Guarded upstream, but defensive for the exported function's contract.
    return { id: record.id, kind: "retry", attempts: record.attempts };
  }

  try {
    const annotation = await args.upload({
      token: args.token,
      apiUrl: args.apiUrl,
      ...(record.projectId && record.payload.branch
        ? { projectId: record.projectId, branch: record.payload.branch }
        : {}),
      capture: record.payload.capture,
      commentText: record.payload.commentText,
      // Optional classifiers (ADR-0016 / G1, G2). Older records enqueued
      // before these were added are missing the keys entirely; spread them
      // only when present so we don't ship literal `undefined`.
      ...(record.payload.intent !== undefined ? { intent: record.payload.intent } : {}),
      ...(record.payload.severity !== undefined ? { severity: record.payload.severity } : {}),
      // G17: present on records enqueued from a multi-element batch. Older
      // records and single-pick records omit it; spread only when defined.
      ...(record.payload.groupId !== undefined ? { groupId: record.payload.groupId } : {}),
    });
    await removeRecord(record.id);
    return { id: record.id, kind: "ok", annotation };
  } catch (err) {
    const nowMs = args.now();
    const retryable = isRetryable(err);
    const attempts = record.attempts + 1;
    const nonRetryable = !retryable;
    const giveUp = nonRetryable || attempts >= MAX_ATTEMPTS;
    const updated: OutboxRecord = {
      ...record,
      attempts,
      lastError: normalizeError(err),
      lastAttemptAt: nowMs,
      nextAttemptAt: nowMs + DRAIN_INTERVAL_MS,
      state: giveUp ? "error" : "pending",
    };
    await updateRecord(updated);
    return {
      id: record.id,
      kind: giveUp ? "error" : "retry",
      attempts,
    };
  }
}

function normalizeError(err: unknown): NonNullable<OutboxRecord["lastError"]> {
  if (err instanceof UploadAnnotationError) {
    return {
      step: err.step,
      message: err.message,
      status: err.status ?? null,
    };
  }
  return {
    step: "create",
    message: err instanceof Error ? err.message : String(err),
    status: null,
  };
}
