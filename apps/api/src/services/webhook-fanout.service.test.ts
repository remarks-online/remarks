import { describe, expect, test, vi } from "vitest";
import type { AppInngest } from "../inngest/client.js";
import { fanOutAnnotationEvent } from "./webhook-fanout.service.js";

interface FakeWebhook {
  id: string;
  projectId: string;
  events: string[];
}

function makeFakeDb(rows: FakeWebhook[]) {
  return {
    query: {
      projectWebhooks: {
        findMany: vi.fn().mockResolvedValue(rows),
      },
    },
    // biome-ignore lint/suspicious/noExplicitAny: test-only DB stub
  } as any;
}

function makeFakeInngest() {
  const send = vi.fn().mockResolvedValue(undefined);
  return { send } as unknown as AppInngest;
}

describe("fanOutAnnotationEvent", () => {
  test("personal annotations short-circuit (no DB read)", async () => {
    const db = makeFakeDb([]);
    const inngest = makeFakeInngest();
    await fanOutAnnotationEvent(db, inngest, {
      annotationEventType: "created",
      projectId: null,
      annotationId: "ann-1",
      payload: {},
      occurredAt: new Date(),
    });
    expect(db.query.projectWebhooks.findMany).not.toHaveBeenCalled();
    expect(inngest.send as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  test("event types without a webhook mapping (e.g. intent_changed) skip fan-out", async () => {
    const db = makeFakeDb([]);
    const inngest = makeFakeInngest();
    await fanOutAnnotationEvent(db, inngest, {
      annotationEventType: "intent_changed",
      projectId: "proj-1",
      annotationId: "ann-1",
      payload: {},
      occurredAt: new Date(),
    });
    expect(db.query.projectWebhooks.findMany).not.toHaveBeenCalled();
    expect(inngest.send as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  test("dispatches one event per matching subscribed webhook", async () => {
    const db = makeFakeDb([
      { id: "w-1", projectId: "p-1", events: ["annotation.created"] },
      { id: "w-2", projectId: "p-1", events: ["annotation.resolved"] }, // unsubscribed
      { id: "w-3", projectId: "p-1", events: ["annotation.created", "annotation.status_changed"] },
    ]);
    const inngest = makeFakeInngest();
    await fanOutAnnotationEvent(db, inngest, {
      annotationEventType: "created",
      projectId: "p-1",
      annotationId: "ann-1",
      payload: { foo: "bar" },
      occurredAt: new Date("2026-05-02T00:00:00Z"),
    });
    const send = inngest.send as ReturnType<typeof vi.fn>;
    expect(send).toHaveBeenCalledTimes(1);
    const [batch] = send.mock.calls[0] as [
      Array<{ name: string; data: { webhookId: string; eventType: string } }>,
    ];
    expect(batch).toHaveLength(2);
    expect(batch.map((e) => e.data.webhookId).sort()).toEqual(["w-1", "w-3"]);
    expect(batch.every((e) => e.data.eventType === "annotation.created")).toBe(true);
  });

  test("status_changed → done synthesizes annotation.resolved alongside the primary event", async () => {
    const db = makeFakeDb([
      { id: "w-status", projectId: "p-1", events: ["annotation.status_changed"] },
      { id: "w-resolved", projectId: "p-1", events: ["annotation.resolved"] },
      {
        id: "w-both",
        projectId: "p-1",
        events: ["annotation.status_changed", "annotation.resolved"],
      },
    ]);
    const inngest = makeFakeInngest();
    await fanOutAnnotationEvent(db, inngest, {
      annotationEventType: "status_changed",
      projectId: "p-1",
      annotationId: "ann-1",
      payload: { from: "doing", to: "done" },
      occurredAt: new Date("2026-05-02T00:00:00Z"),
      newStatus: "done",
    });
    const send = inngest.send as ReturnType<typeof vi.fn>;
    expect(send).toHaveBeenCalledTimes(1);
    const [batch] = send.mock.calls[0] as [
      Array<{ data: { webhookId: string; eventType: string } }>,
    ];
    // Expect: w-status (status_changed), w-resolved (resolved), w-both (both events).
    expect(batch).toHaveLength(4);
    const grouped = batch.reduce<Record<string, string[]>>((acc, e) => {
      const existing = acc[e.data.webhookId] ?? [];
      existing.push(e.data.eventType);
      acc[e.data.webhookId] = existing;
      return acc;
    }, {});
    expect(grouped["w-status"]).toEqual(["annotation.status_changed"]);
    expect(grouped["w-resolved"]).toEqual(["annotation.resolved"]);
    expect(grouped["w-both"]?.sort()).toEqual(["annotation.resolved", "annotation.status_changed"]);
  });

  test("agent_commented maps to annotation.comment_added", async () => {
    const db = makeFakeDb([{ id: "w-1", projectId: "p-1", events: ["annotation.comment_added"] }]);
    const inngest = makeFakeInngest();
    await fanOutAnnotationEvent(db, inngest, {
      annotationEventType: "agent_commented",
      projectId: "p-1",
      annotationId: "ann-1",
      payload: { comment: "hi" },
      occurredAt: new Date(),
    });
    const send = inngest.send as ReturnType<typeof vi.fn>;
    expect(send).toHaveBeenCalledTimes(1);
    const [batch] = send.mock.calls[0] as [Array<{ data: { eventType: string } }>];
    expect(batch).toHaveLength(1);
    expect(batch[0]?.data.eventType).toBe("annotation.comment_added");
  });

  test("no matching subscribers → no inngest.send call", async () => {
    const db = makeFakeDb([{ id: "w-1", projectId: "p-1", events: ["annotation.resolved"] }]);
    const inngest = makeFakeInngest();
    await fanOutAnnotationEvent(db, inngest, {
      annotationEventType: "created",
      projectId: "p-1",
      annotationId: "ann-1",
      payload: {},
      occurredAt: new Date(),
    });
    const send = inngest.send as ReturnType<typeof vi.fn>;
    expect(send).not.toHaveBeenCalled();
  });

  test("inngest.send failures are swallowed (best-effort)", async () => {
    const db = makeFakeDb([{ id: "w-1", projectId: "p-1", events: ["annotation.created"] }]);
    const send = vi.fn().mockRejectedValue(new Error("inngest down"));
    const inngest = { send } as unknown as AppInngest;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      fanOutAnnotationEvent(db, inngest, {
        annotationEventType: "created",
        projectId: "p-1",
        annotationId: "ann-1",
        payload: {},
        occurredAt: new Date(),
      })
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
