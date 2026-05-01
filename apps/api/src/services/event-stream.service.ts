import { type DB, schema } from "@remarks/db";
import {
  type AnnotationStreamEvent,
  buildStreamEventId,
  parseStreamEventId,
} from "@remarks/shared";
import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm";

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
