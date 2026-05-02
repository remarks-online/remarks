import { createHmac, timingSafeEqual } from "node:crypto";
import { type DB, schema } from "@remarks/db";
import {
  WEBHOOK_BODY_VERSION,
  WEBHOOK_DELIVERY_ID_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  type WebhookDeliverData,
} from "@remarks/shared";
import { eq } from "drizzle-orm";
import { inngest } from "../client.js";

interface MinimalStep {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
}

interface MinimalLogger {
  info(obj: unknown, msg: string): void;
  warn(obj: unknown, msg: string): void;
  error(obj: unknown, msg: string): void;
}

const REQUEST_TIMEOUT_MS = 10_000;
const RESPONSE_BODY_SNIPPET_BYTES = 1024;

export interface WebhookDeliverDeps {
  db: DB;
  step: MinimalStep;
  logger: MinimalLogger;
  // Override for tests; defaults to global fetch with a timeout.
  fetchImpl?: typeof fetch;
  // Override for tests; defaults to Date.now-based unix seconds.
  nowSeconds?: () => number;
  // 1-based; sourced from Inngest's `attempt` field at the call site.
  attempt: number;
}

export interface WebhookDeliverResult {
  status: "delivered" | "skipped" | "failed";
  responseStatus: number | null;
}

// Pure handler — exported for unit tests. Loads the webhook row, signs the
// payload, POSTs it, and writes one delivery row per attempt regardless of
// outcome. Throws on non-2xx so Inngest's retry policy kicks in.
export async function runWebhookDeliver(
  deps: WebhookDeliverDeps,
  data: WebhookDeliverData
): Promise<WebhookDeliverResult> {
  const { db, step, logger, attempt } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowSeconds = deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  const webhook = await step.run("load-webhook", async () => {
    const row = await db.query.projectWebhooks.findFirst({
      where: eq(schema.projectWebhooks.id, data.webhookId),
      columns: { id: true, projectId: true, url: true, secret: true, events: true, active: true },
    });
    return row ?? null;
  });

  // Webhook deleted between publish and delivery, or disabled — exit cleanly.
  // Same outcome for "no longer subscribed to this event type" (a customer
  // edited the events list after we published).
  if (!webhook || !webhook.active || !webhook.events.includes(data.eventType)) {
    logger.info(
      {
        webhookId: data.webhookId,
        eventType: data.eventType,
        reason: !webhook ? "missing" : !webhook.active ? "inactive" : "unsubscribed",
      },
      "webhook-deliver: skipped"
    );
    return { status: "skipped", responseStatus: null };
  }

  const body = JSON.stringify({
    version: WEBHOOK_BODY_VERSION,
    type: data.eventType,
    occurredAt: data.occurredAt,
    data: data.payload,
  });
  const t = nowSeconds();
  const signature = signBody(webhook.secret, t, body);

  const result = await step.run(`deliver-attempt-${attempt}`, async () => {
    const deliveryRowId = await insertDeliveryRow(db, {
      webhookId: webhook.id,
      annotationId: data.annotationId,
      eventType: data.eventType,
      attempt,
      requestBodySize: Buffer.byteLength(body),
    });

    let responseStatus: number | null = null;
    let responseBodySnippet: string | null = null;
    let errorMessage: string | null = null;
    let succeeded = false;

    try {
      const response = await postWithTimeout(fetchImpl, webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Remarks-Webhooks/1.0",
          [WEBHOOK_SIGNATURE_HEADER]: `t=${t},v1=${signature}`,
          [WEBHOOK_EVENT_HEADER]: data.eventType,
          [WEBHOOK_DELIVERY_ID_HEADER]: deliveryRowId,
        },
        body,
      });
      responseStatus = response.status;
      responseBodySnippet = await readSnippet(response);
      succeeded = response.status >= 200 && response.status < 300;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    await db
      .update(schema.projectWebhookDeliveries)
      .set({
        responseStatus,
        responseBodySnippet,
        errorMessage,
        succeeded,
        deliveredAt: new Date(),
      })
      .where(eq(schema.projectWebhookDeliveries.id, deliveryRowId));

    return { succeeded, responseStatus, errorMessage };
  });

  if (!result.succeeded) {
    logger.warn(
      {
        webhookId: webhook.id,
        eventType: data.eventType,
        attempt,
        responseStatus: result.responseStatus,
        errorMessage: result.errorMessage,
      },
      "webhook-deliver: attempt failed"
    );
    // Throw so Inngest retries with exponential backoff. Final failure persists
    // as the last delivery row's `succeeded=false`.
    throw new Error(
      `webhook delivery failed: status=${result.responseStatus ?? "n/a"} error=${result.errorMessage ?? "n/a"}`
    );
  }

  logger.info(
    {
      webhookId: webhook.id,
      eventType: data.eventType,
      attempt,
      responseStatus: result.responseStatus,
    },
    "webhook-deliver: delivered"
  );
  return { status: "delivered", responseStatus: result.responseStatus };
}

// Stripe-style: HMAC-SHA256 of `${t}.${body}`. Hex-encoded.
export function signBody(secret: string, unixSeconds: number, body: string): string {
  return createHmac("sha256", secret).update(`${unixSeconds}.${body}`).digest("hex");
}

// Constant-time check for tests / docs. Receivers should do this themselves;
// kept here so the integration tests can verify our outbound headers.
export function verifySignature(secret: string, header: string, body: string): boolean {
  const parts = header.split(",").reduce<Record<string, string>>((acc, kv) => {
    const [k, v] = kv.split("=");
    if (k && v) acc[k] = v;
    return acc;
  }, {});
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  const expected = signBody(secret, Number(t), body);
  if (expected.length !== v1.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(v1, "hex"));
  } catch {
    return false;
  }
}

async function postWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readSnippet(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    if (!text) return null;
    return text.length > RESPONSE_BODY_SNIPPET_BYTES
      ? text.slice(0, RESPONSE_BODY_SNIPPET_BYTES)
      : text;
  } catch {
    return null;
  }
}

async function insertDeliveryRow(
  db: DB,
  values: {
    webhookId: string;
    annotationId: string;
    eventType: string;
    attempt: number;
    requestBodySize: number;
  }
): Promise<string> {
  const [row] = await db
    .insert(schema.projectWebhookDeliveries)
    .values(values)
    .returning({ id: schema.projectWebhookDeliveries.id });
  if (!row) throw new Error("project_webhook_deliveries insert returned no rows");
  return row.id;
}

// Factory captures the DB connection. Inngest provides `attempt` on the
// invocation context so we can stamp delivery rows correctly across retries.
export function createWebhookDeliverFunction(db: DB) {
  return inngest.createFunction(
    { id: "webhook-deliver", name: "Outbound webhook delivery", retries: 4 },
    { event: "remarks/webhook.deliver" },
    async ({ event, step, logger, attempt }) =>
      runWebhookDeliver(
        { db, step: step as unknown as MinimalStep, logger, attempt: attempt + 1 },
        event.data
      )
  );
}
