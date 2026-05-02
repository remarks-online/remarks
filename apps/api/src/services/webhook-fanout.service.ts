import { type DB, schema } from "@remarks/db";
import type { WebhookEventType } from "@remarks/shared";
import { and, eq } from "drizzle-orm";
import type { AppInngest } from "../inngest/client.js";

// Annotation event types that map onto a webhook event type. Internal-only
// events (intent_changed, severity_changed, agent_acknowledged, comment_edited,
// asset_attached, etc.) are deliberately omitted in v1.
const ANNOTATION_TO_WEBHOOK_EVENT: Partial<Record<string, WebhookEventType>> = {
  created: "annotation.created",
  status_changed: "annotation.status_changed",
  agent_updated_status: "annotation.status_changed",
  // Both internal "agent commented" lands here; user comment edits go through
  // `comment_edited` which we do not surface as a webhook event in v1.
  agent_commented: "annotation.comment_added",
  comment_added: "annotation.comment_added",
};

export interface FanOutAnnotationEventArgs {
  // Source annotation event type from `annotation_event_type_enum`.
  annotationEventType: string;
  // Webhooks are project-scoped only; personal annotations skip the fan-out.
  projectId: string | null;
  annotationId: string;
  // Annotation event payload — embedded as the `data` field of the outbound
  // webhook envelope.
  payload: Record<string, unknown>;
  occurredAt: Date;
  // When the source event indicates the annotation transitioned to `done`,
  // we also fire a synthetic `annotation.resolved` event. The caller passes
  // the resolved status (or null) so the service doesn't have to re-read.
  newStatus?: string | null;
}

// Fan out a single annotation-event write to every active project webhook
// subscribed to the corresponding webhook event type. Best-effort: catches
// publish failures and logs, never throws back to the request path.
export async function fanOutAnnotationEvent(
  db: DB,
  inngest: AppInngest,
  args: FanOutAnnotationEventArgs
): Promise<void> {
  if (!args.projectId) return;
  const primary = ANNOTATION_TO_WEBHOOK_EVENT[args.annotationEventType];
  // Synthesize `annotation.resolved` whenever a status transition lands on
  // `done`. Receivers subscribing only to `annotation.resolved` don't need to
  // also subscribe to `annotation.status_changed`.
  const resolved: WebhookEventType | null =
    args.newStatus === "done" ? "annotation.resolved" : null;
  if (!primary && !resolved) return;

  const webhooks = await db.query.projectWebhooks.findMany({
    where: and(
      eq(schema.projectWebhooks.projectId, args.projectId),
      eq(schema.projectWebhooks.active, true)
    ),
    columns: { id: true, projectId: true, events: true },
  });
  if (webhooks.length === 0) return;

  const events: Array<{
    name: "remarks/webhook.deliver";
    data: {
      webhookId: string;
      projectId: string;
      annotationId: string;
      eventType: WebhookEventType;
      payload: Record<string, unknown>;
      occurredAt: string;
    };
  }> = [];

  const occurredAtIso = args.occurredAt.toISOString();
  for (const webhook of webhooks) {
    if (primary && webhook.events.includes(primary)) {
      events.push({
        name: "remarks/webhook.deliver",
        data: {
          webhookId: webhook.id,
          projectId: webhook.projectId,
          annotationId: args.annotationId,
          eventType: primary,
          payload: args.payload,
          occurredAt: occurredAtIso,
        },
      });
    }
    if (resolved && webhook.events.includes(resolved)) {
      events.push({
        name: "remarks/webhook.deliver",
        data: {
          webhookId: webhook.id,
          projectId: webhook.projectId,
          annotationId: args.annotationId,
          eventType: resolved,
          payload: args.payload,
          occurredAt: occurredAtIso,
        },
      });
    }
  }

  if (events.length === 0) return;
  try {
    await inngest.send(events);
  } catch (err) {
    console.error("[webhook-fanout] failed to publish events", {
      projectId: args.projectId,
      annotationId: args.annotationId,
      annotationEventType: args.annotationEventType,
      eventCount: events.length,
      err,
    });
  }
}
