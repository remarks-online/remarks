import { PostHog } from "posthog-node";
import { env } from "../env.js";

// Spec §7.5 — server-side capture call sites:
//   org_created               (apps/api/src/routes/webhooks/clerk.ts)
//   annotation_created        (apps/api/src/services/annotation.service.ts)
//   annotation_status_changed (apps/api/src/services/annotation.service.ts)
// Keep this list in sync.
export type ServerAnalyticsEvent =
  | "org_created"
  | "annotation_created"
  | "annotation_status_changed";

let client: PostHog | null = null;

function getClient(): PostHog | null {
  if (!env.POSTHOG_PROJECT_API_KEY) return null;
  if (!client) {
    client = new PostHog(env.POSTHOG_PROJECT_API_KEY, {
      host: env.POSTHOG_HOST,
      // Server is low-volume; flush each event so process exits don't drop them.
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return client;
}

export interface ServerCaptureArgs {
  event: ServerAnalyticsEvent;
  distinctId: string;
  properties?: Record<string, unknown>;
}

// Best-effort fire-and-forget. PostHog outages must never block writes.
export function capture({ event, distinctId, properties }: ServerCaptureArgs): void {
  const c = getClient();
  if (!c) return;
  try {
    c.capture({
      distinctId,
      event,
      ...(properties ? { properties } : {}),
    });
  } catch {
    // Swallow — analytics MUST NOT break the request path.
  }
}

export async function shutdownAnalytics(): Promise<void> {
  if (!client) return;
  try {
    await client.shutdown();
  } finally {
    client = null;
  }
}
