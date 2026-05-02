import { createHmac } from "node:crypto";
import { WEBHOOK_SIGNATURE_HEADER, type WebhookDeliverData } from "@remarks/shared";
import { describe, expect, test, vi } from "vitest";
import { runWebhookDeliver, signBody, verifySignature } from "./webhook-deliver.js";

// Inngest's step.run, simplified: run the callback and return its value.
const passthroughStep = {
  async run<T>(_id: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  },
};

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

interface FakeWebhookRow {
  id: string;
  projectId: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
}

interface DeliveryRow {
  id: string;
  webhookId: string;
  eventType: string;
  attempt: number;
  responseStatus: number | null;
  succeeded: boolean;
  errorMessage: string | null;
}

// Hand-rolled fake DB: query.projectWebhooks.findFirst, insert returning,
// update where. Just enough surface to drive the handler.
function makeFakeDb(initialRow: FakeWebhookRow | null) {
  const inserted: DeliveryRow[] = [];
  let lastId = 0;
  const updates: Array<{ id: string; patch: Partial<DeliveryRow> }> = [];

  const db = {
    query: {
      projectWebhooks: {
        findFirst: vi.fn().mockResolvedValue(initialRow),
      },
    },
    insert(_table: unknown) {
      return {
        values(values: {
          webhookId: string;
          annotationId: string;
          eventType: string;
          attempt: number;
          requestBodySize: number;
        }) {
          return {
            returning() {
              const id = `delivery-${++lastId}`;
              const row: DeliveryRow = {
                id,
                webhookId: values.webhookId,
                eventType: values.eventType,
                attempt: values.attempt,
                responseStatus: null,
                succeeded: false,
                errorMessage: null,
              };
              inserted.push(row);
              return Promise.resolve([{ id }]);
            },
          };
        },
      };
    },
    update(_table: unknown) {
      return {
        set(patch: Partial<DeliveryRow>) {
          return {
            where(_predicate: unknown) {
              const row = inserted[inserted.length - 1];
              if (row) {
                Object.assign(row, patch);
                updates.push({ id: row.id, patch });
              }
              return Promise.resolve();
            },
          };
        },
      };
    },
  };

  // biome-ignore lint/suspicious/noExplicitAny: test-only DB stub
  return { db: db as any, inserted, updates };
}

const sampleData: WebhookDeliverData = {
  webhookId: "wh-1",
  projectId: "proj-1",
  annotationId: "ann-1",
  eventType: "annotation.created",
  payload: { hello: "world" },
  occurredAt: "2026-05-02T15:00:00.000Z",
};

const activeWebhook: FakeWebhookRow = {
  id: "wh-1",
  projectId: "proj-1",
  url: "https://example.com/hook",
  secret: "supersecret",
  events: ["annotation.created"],
  active: true,
};

describe("runWebhookDeliver", () => {
  test("signs and posts on a 200, marks delivery as succeeded", async () => {
    const { db, inserted } = makeFakeDb(activeWebhook);
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    const result = await runWebhookDeliver(
      {
        db,
        step: passthroughStep,
        logger: silentLogger,
        fetchImpl,
        attempt: 1,
        nowSeconds: () => 1700000000,
      },
      sampleData
    );

    expect(result).toEqual({ status: "delivered", responseStatus: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("https://example.com/hook");
    expect((init.headers as Record<string, string>)[WEBHOOK_SIGNATURE_HEADER]).toMatch(
      /^t=1700000000,v1=[a-f0-9]+$/
    );
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.succeeded).toBe(true);
    expect(inserted[0]?.responseStatus).toBe(200);
  });

  test("throws on non-2xx so Inngest retries; delivery row records failure", async () => {
    const { db, inserted } = makeFakeDb(activeWebhook);
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));

    await expect(
      runWebhookDeliver(
        { db, step: passthroughStep, logger: silentLogger, fetchImpl, attempt: 1 },
        sampleData
      )
    ).rejects.toThrow(/webhook delivery failed/);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.succeeded).toBe(false);
    expect(inserted[0]?.responseStatus).toBe(500);
  });

  test("throws on transport error and records the message", async () => {
    const { db, inserted } = makeFakeDb(activeWebhook);
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));

    await expect(
      runWebhookDeliver(
        { db, step: passthroughStep, logger: silentLogger, fetchImpl, attempt: 1 },
        sampleData
      )
    ).rejects.toThrow(/webhook delivery failed/);
    expect(inserted[0]?.succeeded).toBe(false);
    expect(inserted[0]?.errorMessage).toBe("ECONNRESET");
  });

  test("short-circuits without fetch when webhook is inactive", async () => {
    const { db, inserted } = makeFakeDb({ ...activeWebhook, active: false });
    const fetchImpl = vi.fn();

    const result = await runWebhookDeliver(
      { db, step: passthroughStep, logger: silentLogger, fetchImpl, attempt: 1 },
      sampleData
    );

    expect(result).toEqual({ status: "skipped", responseStatus: null });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  test("short-circuits when webhook is no longer subscribed to the event", async () => {
    const { db, inserted } = makeFakeDb({
      ...activeWebhook,
      events: ["annotation.resolved"],
    });
    const fetchImpl = vi.fn();

    const result = await runWebhookDeliver(
      { db, step: passthroughStep, logger: silentLogger, fetchImpl, attempt: 1 },
      sampleData
    );

    expect(result.status).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  test("short-circuits when webhook has been deleted", async () => {
    const { db } = makeFakeDb(null);
    const fetchImpl = vi.fn();

    const result = await runWebhookDeliver(
      { db, step: passthroughStep, logger: silentLogger, fetchImpl, attempt: 1 },
      sampleData
    );

    expect(result.status).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("signBody / verifySignature", () => {
  test("verifies a freshly-signed payload", () => {
    const body = JSON.stringify({ hello: "world" });
    const t = 1700000000;
    const sig = signBody("secret", t, body);
    expect(verifySignature("secret", `t=${t},v1=${sig}`, body)).toBe(true);
  });

  test("rejects a tampered body", () => {
    const t = 1700000000;
    const sig = signBody("secret", t, "original");
    expect(verifySignature("secret", `t=${t},v1=${sig}`, "tampered")).toBe(false);
  });

  test("rejects a wrong secret", () => {
    const body = "x";
    const t = 1700000000;
    const sig = signBody("secret", t, body);
    expect(verifySignature("other", `t=${t},v1=${sig}`, body)).toBe(false);
  });

  test("matches manual HMAC computation", () => {
    const body = "payload";
    const t = 12345;
    const expected = createHmac("sha256", "k").update(`${t}.${body}`).digest("hex");
    expect(signBody("k", t, body)).toBe(expected);
  });
});
