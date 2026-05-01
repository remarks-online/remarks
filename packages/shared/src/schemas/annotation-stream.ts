import { z } from "zod";
import { annotationEventTypeSchema, eventActorTypeSchema } from "./annotation-event.js";

// Wire envelope for the SSE stream (G9). Compact on purpose — Postgres NOTIFY
// has an 8 KB payload ceiling and we want headroom for future fields.
//
// The `id` is the SSE event id used by browsers to populate `Last-Event-ID` on
// reconnect. Encoded as `<createdAtIso>:<eventUuid>` so a string compare yields
// the same ordering as the (createdAt, id) keyset used elsewhere in the API.
export const annotationStreamEventSchema = z.object({
  id: z.string().min(1),
  type: annotationEventTypeSchema,
  annotationId: z.string().uuid(),
  // Null when the underlying annotation is personal (no project).
  projectId: z.string().uuid().nullable(),
  // Internal user UUID of the annotation's author. Drives the per-user fan-out
  // for personal annotations (route asserts caller === authorId for personals).
  authorId: z.string().uuid(),
  actorType: eventActorTypeSchema,
  actorId: z.string().uuid().nullable(),
  actorOauthClientId: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export type AnnotationStreamEvent = z.infer<typeof annotationStreamEventSchema>;

// Helper: build the `<createdAtIso>:<uuid>` resume id used as the SSE event id.
export function buildStreamEventId(createdAt: Date, eventId: string): string {
  return `${createdAt.toISOString()}:${eventId}`;
}

// Helper: split a resume id back into (createdAt, eventId). Returns null when
// the input doesn't match the expected shape — callers fall back to a fresh
// subscription instead of treating this as fatal.
export function parseStreamEventId(raw: string): { createdAt: Date; eventId: string } | null {
  const sep = raw.indexOf(":");
  // UUID is 36 chars; "iso:uuid" → first colon is at the iso/uuid boundary, but
  // ISO timestamps themselves contain colons (e.g. 2026-04-30T12:34:56.789Z).
  // The eventId is always the last 36 chars; the iso is everything before the
  // separating colon. Search from the end.
  if (sep < 0) return null;
  const eventId = raw.slice(-36);
  const isoEnd = raw.length - 37; // strip ":" + uuid
  if (isoEnd <= 0) return null;
  if (raw[isoEnd] !== ":") return null;
  const iso = raw.slice(0, isoEnd);
  const ts = new Date(iso);
  if (Number.isNaN(ts.getTime())) return null;
  // Loose UUID shape check; defends against a paste-error landing in a SQL
  // round-trip without needing to import a uuid validator here.
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return null;
  return { createdAt: ts, eventId };
}
