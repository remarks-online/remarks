import { type DB, schema } from "@remarks/db";
import {
  type AnnotationEventType,
  type AnnotationStreamEvent,
  buildStreamEventId,
  parseStreamEventId,
} from "@remarks/shared";
import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  type SubscribeHandle,
  type Subscriber,
  type SubscriberFilter,
  matches,
} from "../lib/annotation-event-bus.js";

// G9: cap on a single SSE replay batch. The client receives `replay_truncated`
// when the cap is hit and is expected to do a fresh REST list to resync.
export const REPLAY_LIMIT = 200;

// Returns the set of project ids the given internal user belongs to. Frozen at
// subscribe time per the broker contract — connection rotation (5 min) is the
// invalidation mechanism, not a live refresh.
export async function loadUserProjectIds(db: DB, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ projectId: schema.projectMembers.projectId })
    .from(schema.projectMembers)
    .where(eq(schema.projectMembers.userId, userId));
  return new Set(rows.map((r) => r.projectId));
}

interface ReplayResult {
  events: AnnotationStreamEvent[];
  // True iff the DB returned exactly the cap. Routes signal `replay_truncated`
  // to the client so they can decide whether to refresh state via REST.
  truncated: boolean;
}

// Project-scoped DB replay. Returns events strictly newer than the resume
// cursor, ordered ASC by (createdAt, id), capped at REPLAY_LIMIT. Caller
// already validated that the requesting user has membership.
export async function replayProjectEventsSince(
  db: DB,
  projectId: string,
  sinceId: string
): Promise<ReplayResult> {
  const cursor = parseStreamEventId(sinceId);
  if (!cursor) return { events: [], truncated: false };
  const rows = await db
    .select(eventSelectColumns)
    .from(schema.annotationEvents)
    .innerJoin(schema.annotations, eq(schema.annotations.id, schema.annotationEvents.annotationId))
    .where(
      and(eq(schema.annotations.projectId, projectId), keysetGt(cursor.createdAt, cursor.eventId))
    )
    .orderBy(asc(schema.annotationEvents.createdAt), asc(schema.annotationEvents.id))
    .limit(REPLAY_LIMIT);
  return {
    events: rows.map(toStreamEvent),
    truncated: rows.length === REPLAY_LIMIT,
  };
}

// Per-user DB replay: events on annotations the user authors (personal) plus
// events on any project they're a member of. `projectIds` is the snapshot
// taken at subscribe time; mid-stream membership additions are missed until
// the next reconnect, which is fine for v1.
export async function replayUserEventsSince(
  db: DB,
  args: { userId: string; projectIds: ReadonlySet<string>; sinceId: string }
): Promise<ReplayResult> {
  const cursor = parseStreamEventId(args.sinceId);
  if (!cursor) return { events: [], truncated: false };
  const projectIds = [...args.projectIds];
  const personalScope = and(
    eq(schema.annotations.authorId, args.userId),
    isNull(schema.annotations.projectId)
  );
  const projectScope =
    projectIds.length > 0 ? inArray(schema.annotations.projectId, projectIds) : undefined;
  const scopePredicate = projectScope ? or(personalScope, projectScope) : personalScope;
  const rows = await db
    .select(eventSelectColumns)
    .from(schema.annotationEvents)
    .innerJoin(schema.annotations, eq(schema.annotations.id, schema.annotationEvents.annotationId))
    .where(and(scopePredicate, keysetGt(cursor.createdAt, cursor.eventId)))
    .orderBy(asc(schema.annotationEvents.createdAt), asc(schema.annotationEvents.id))
    .limit(REPLAY_LIMIT);
  return {
    events: rows.map(toStreamEvent),
    truncated: rows.length === REPLAY_LIMIT,
  };
}

// (createdAt, id) > (cursor.createdAt, cursor.id) — keyset comparison ensures
// no events are missed when many share the same timestamp.
function keysetGt(createdAt: Date, eventId: string) {
  return or(
    gt(schema.annotationEvents.createdAt, createdAt),
    and(eq(schema.annotationEvents.createdAt, createdAt), gt(schema.annotationEvents.id, eventId))
  );
}

const eventSelectColumns = {
  eventId: schema.annotationEvents.id,
  type: schema.annotationEvents.type,
  payload: schema.annotationEvents.payload,
  createdAt: schema.annotationEvents.createdAt,
  actorType: schema.annotationEvents.actorType,
  actorId: schema.annotationEvents.actorId,
  actorOauthClientId: schema.annotationEvents.actorOauthClientId,
  annotationId: schema.annotationEvents.annotationId,
  projectId: schema.annotations.projectId,
  authorId: schema.annotations.authorId,
} as const;

type EventRow = {
  eventId: string;
  type: AnnotationStreamEvent["type"];
  payload: Record<string, unknown>;
  createdAt: Date;
  actorType: AnnotationStreamEvent["actorType"];
  actorId: string | null;
  actorOauthClientId: string | null;
  annotationId: string;
  projectId: string | null;
  authorId: string;
};

// G10: long-poll collector. Mirrors the SSE handler's replay-then-subscribe
// dance but yields a single batch instead of streaming. Used by the watch
// endpoint (`apps/api/src/routes/internal/watch.ts`).
//
// Lifecycle (always unsubscribes before returning):
//   1. Subscribe to the bus with a sink that buffers into `pending`. No live
//      delivery — we want a stable snapshot to return.
//   2. If `sinceId` is set, replay matching events strictly newer than the
//      cursor. Buffer hit → no DB read; buffer miss → one capped DB read.
//   3. Drain `pending` (events that arrived during replay), skipping ids the
//      replay already covered.
//   4. If we already have ≥1 matching event, return without waiting.
//   5. Else wait up to `waitMs` for the first matching event. After it
//      arrives, hold for `batchWindowMs` to coalesce a clustered burst.
//   6. Cap at `limit`. `idleTimeout: true` iff we returned because of (5)
//      hitting the deadline with zero events.
//
// `eventTypes` is an optional pre-filter applied at the sink — cheaper than
// post-filtering and the only filter axis the bus itself can't apply (the
// rest — intent / severity / status / branch — live on the annotation row,
// so the route layer applies them after hydration).
//
// Caller is responsible for project-membership / personal-scope authorization
// before invoking; this helper trusts the filter.
export interface CollectOptions {
  fastify: FastifyInstance;
  filter: SubscriberFilter;
  sinceId: string | null;
  waitMs: number;
  batchWindowMs: number;
  limit: number;
  eventTypes?: ReadonlySet<AnnotationEventType>;
  abortSignal?: AbortSignal;
}

export interface CollectResult {
  events: AnnotationStreamEvent[];
  replayTruncated: boolean;
  // True iff the call returned because the wait deadline fired with no
  // matching events. False on immediate replay hits, on burst returns, and
  // on aborted calls.
  idleTimeout: boolean;
}

export async function collectAnnotationEvents(opts: CollectOptions): Promise<CollectResult> {
  const { fastify, filter, sinceId, waitMs, batchWindowMs, limit, eventTypes, abortSignal } = opts;

  // Ensure LISTEN is attached before we subscribe + replay (matches the SSE
  // handler's contract).
  await fastify.annotationEventBus.start();

  const collected: AnnotationStreamEvent[] = [];
  // During the replay window, sink events into `pending` so we don't lose
  // any that arrive while we're walking the buffer or hitting the DB.
  let phase: "replay" | "live" = "replay";
  const pending: AnnotationStreamEvent[] = [];
  // Latch fires once when the first matching event lands during the wait
  // phase, kicking the burst-window timer.
  let firstEventResolver: (() => void) | null = null;

  const passesEventTypeFilter = (ev: AnnotationStreamEvent): boolean => {
    if (eventTypes === undefined) return true;
    return eventTypes.has(ev.type);
  };

  const sink = (event: AnnotationStreamEvent): void => {
    if (!passesEventTypeFilter(event)) return;
    if (phase === "replay") {
      pending.push(event);
      return;
    }
    if (collected.length >= limit) return;
    collected.push(event);
    if (firstEventResolver !== null) {
      const r = firstEventResolver;
      firstEventResolver = null;
      r();
    }
  };

  const subscriber: Subscriber =
    filter.kind === "project"
      ? { kind: "project", projectId: filter.projectId, sink }
      : { kind: "user", userId: filter.userId, projectIds: filter.projectIds, sink };

  let handle: SubscribeHandle;
  handle = fastify.annotationEventBus.subscribe(subscriber);

  let replayTruncated = false;
  let idleTimeout = false;
  let latestDeliveredId: string | null = null;
  try {
    // ── Replay ─────────────────────────────────────────────────────────
    if (sinceId !== null) {
      const buffered = fastify.annotationEventBus.replayBuffered(filter, sinceId);
      if (buffered !== null) {
        for (const ev of buffered) {
          if (collected.length >= limit) break;
          if (!passesEventTypeFilter(ev)) continue;
          collected.push(ev);
          latestDeliveredId = ev.id;
        }
      } else {
        // Cursor missed the in-memory window — single DB read, capped.
        const result =
          filter.kind === "project"
            ? await replayProjectEventsSince(fastify.db, filter.projectId, sinceId)
            : await replayUserEventsSince(fastify.db, {
                userId: filter.userId,
                projectIds: filter.projectIds,
                sinceId,
              });
        for (const ev of result.events) {
          if (collected.length >= limit) break;
          if (!passesEventTypeFilter(ev)) continue;
          collected.push(ev);
          latestDeliveredId = ev.id;
        }
        replayTruncated = result.truncated;
      }
    }

    // ── Drain pending (events that arrived during replay) ─────────────
    for (const ev of pending) {
      if (collected.length >= limit) break;
      if (latestDeliveredId !== null && ev.id <= latestDeliveredId) continue;
      if (!matches(filter, ev)) continue; // defensive — broker already filtered
      collected.push(ev);
      latestDeliveredId = ev.id;
    }
    pending.length = 0;
    phase = "live";

    if (collected.length >= 1 || waitMs <= 0) {
      // Already have something to return, OR the caller asked for a non-
      // blocking drain. Skip the wait phase entirely.
      return { events: collected, replayTruncated, idleTimeout: false };
    }

    // ── Wait for first event ──────────────────────────────────────────
    // Race: first matching event vs. wait deadline vs. caller abort.
    const firstEventPromise = new Promise<void>((resolve) => {
      firstEventResolver = resolve;
    });
    const waitDeadline = new Promise<"timeout">((resolve) => {
      const t = setTimeout(() => resolve("timeout"), waitMs);
      // Don't pin the event loop if the request goes away.
      if (typeof t === "object" && t !== null && "unref" in t) {
        (t as { unref?: () => void }).unref?.();
      }
    });
    const abortPromise = abortSignal
      ? new Promise<"abort">((resolve) => {
          if (abortSignal.aborted) {
            resolve("abort");
            return;
          }
          abortSignal.addEventListener("abort", () => resolve("abort"), { once: true });
        })
      : new Promise<never>(() => {});

    const winner = await Promise.race([
      firstEventPromise.then(() => "event" as const),
      waitDeadline,
      abortPromise,
    ]);

    if (winner === "abort") {
      return { events: collected, replayTruncated, idleTimeout: false };
    }
    if (winner === "timeout") {
      idleTimeout = collected.length === 0;
      return { events: collected, replayTruncated, idleTimeout };
    }

    // First event landed — coalesce a burst within `batchWindowMs`.
    if (batchWindowMs > 0 && collected.length < limit) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, batchWindowMs);
        if (typeof t === "object" && t !== null && "unref" in t) {
          (t as { unref?: () => void }).unref?.();
        }
      });
    }
    return { events: collected, replayTruncated, idleTimeout: false };
  } finally {
    handle.unsubscribe();
  }
}

function toStreamEvent(row: EventRow): AnnotationStreamEvent {
  return {
    id: buildStreamEventId(row.createdAt, row.eventId),
    type: row.type,
    annotationId: row.annotationId,
    projectId: row.projectId,
    authorId: row.authorId,
    actorType: row.actorType,
    actorId: row.actorId,
    actorOauthClientId: row.actorOauthClientId,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  };
}
