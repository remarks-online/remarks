import { z } from "zod";

export const ANNOTATION_EVENT_TYPES = [
  "created",
  "status_changed",
  "comment_added",
  "assigned",
  "pr_linked",
  "asset_attached",
  "resolved",
  "agent_updated_status",
  "agent_commented",
  "comment_edited",
] as const;

export type AnnotationEventType = (typeof ANNOTATION_EVENT_TYPES)[number];

export const EVENT_ACTOR_TYPES = ["user", "agent", "system"] as const;
export type EventActorType = (typeof EVENT_ACTOR_TYPES)[number];

export const annotationEventTypeSchema = z.enum(ANNOTATION_EVENT_TYPES);
export const eventActorTypeSchema = z.enum(EVENT_ACTOR_TYPES);

// Actor is a user when actorType === "user". For agent/system actors in
// Phase 2+, the row has no user row to join to, so actor is null and the
// client relies on actorType (and payload, once agent events land) to render.
export const annotationEventActorSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  email: z.string().email().nullable(),
  avatarUrl: z.string().url().nullable(),
});

export const annotationEventResponseSchema = z.object({
  id: z.string().uuid(),
  annotationId: z.string().uuid(),
  type: annotationEventTypeSchema,
  actorType: eventActorTypeSchema,
  actor: annotationEventActorSchema.nullable(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});

export type AnnotationEventResponse = z.infer<typeof annotationEventResponseSchema>;

export const annotationEventListResponseSchema = z.object({
  events: z.array(annotationEventResponseSchema),
});

export type AnnotationEventListResponse = z.infer<typeof annotationEventListResponseSchema>;
