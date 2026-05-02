import { z } from "zod";

// Curated subset that maps 1:1 to existing annotation_event_type values.
// Internal-only types like `agent_acknowledged` / `intent_changed` are
// deliberately excluded from v1 — extending later is additive.
export const WEBHOOK_EVENT_TYPES = [
  "annotation.created",
  "annotation.status_changed",
  "annotation.comment_added",
  "annotation.resolved",
] as const;

export const webhookEventTypeSchema = z.enum(WEBHOOK_EVENT_TYPES);
export type WebhookEventType = z.infer<typeof webhookEventTypeSchema>;

// Receivers verify with this header. Format mirrors Stripe:
// `t=<unix_seconds>,v1=<hex_hmac_sha256>`. HMAC is over `${t}.${rawBody}`.
export const WEBHOOK_SIGNATURE_HEADER = "Remarks-Signature";
export const WEBHOOK_EVENT_HEADER = "Remarks-Event";
export const WEBHOOK_DELIVERY_ID_HEADER = "Remarks-Delivery-Id";
export const WEBHOOK_BODY_VERSION = "1";

export const webhookResponseSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  url: z.string().url(),
  events: z.array(webhookEventTypeSchema),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WebhookResponse = z.infer<typeof webhookResponseSchema>;

// `secret` is returned only by `create` and `rotateSecret` — once. After that
// it never leaves the database.
export const webhookCreatedResponseSchema = webhookResponseSchema.extend({
  secret: z.string().min(32),
});
export type WebhookCreatedResponse = z.infer<typeof webhookCreatedResponseSchema>;

export const createWebhookRequestSchema = z.object({
  url: z
    .string()
    .url()
    .refine((v) => v.startsWith("https://"), { message: "URL must use https://" }),
  events: z.array(webhookEventTypeSchema).min(1),
});
export type CreateWebhookRequest = z.infer<typeof createWebhookRequestSchema>;

// Partial; at least one field. `active` toggles enable/disable. Url + events
// can be edited in place (re-deliveries continue to use the new values).
export const updateWebhookRequestSchema = z
  .object({
    url: z
      .string()
      .url()
      .refine((v) => v.startsWith("https://"), { message: "URL must use https://" })
      .optional(),
    events: z.array(webhookEventTypeSchema).min(1).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => v.url !== undefined || v.events !== undefined || v.active !== undefined, {
    message: "At least one field must be provided",
  });
export type UpdateWebhookRequest = z.infer<typeof updateWebhookRequestSchema>;

export const webhookDeliveryResponseSchema = z.object({
  id: z.string().uuid(),
  webhookId: z.string().uuid(),
  eventType: z.string(),
  attempt: z.number().int().nonnegative(),
  succeeded: z.boolean(),
  responseStatus: z.number().int().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  deliveredAt: z.string().datetime().nullable(),
});
export type WebhookDeliveryResponse = z.infer<typeof webhookDeliveryResponseSchema>;
