import { afterEach, describe, expect, test } from "vitest";
import type { OutboxRecord } from "./outbox-db";
import { countsOf, outboxStore } from "./outbox-store";
import { makeCapture } from "./outbox-test-utils";

function makeRecord(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  return {
    id: "rec-1",
    clerkOrgId: "org_x",
    projectId: "11111111-1111-4111-8111-111111111111",
    payload: { branch: "main", capture: makeCapture(), commentText: "hi" },
    state: "pending",
    attempts: 0,
    lastError: null,
    createdAt: 1_000,
    lastAttemptAt: null,
    nextAttemptAt: 1_000,
    ...overrides,
  };
}

afterEach(() => {
  outboxStore.getState().clear();
});

describe("outboxStore", () => {
  test("hydrate sorts by createdAt ascending", () => {
    outboxStore
      .getState()
      .hydrate([
        makeRecord({ id: "b", createdAt: 2_000 }),
        makeRecord({ id: "a", createdAt: 1_000 }),
      ]);
    expect(outboxStore.getState().items.map((r) => r.id)).toEqual(["a", "b"]);
  });

  test("upsert adds new record; updates existing by id", () => {
    outboxStore.getState().upsert(makeRecord({ id: "a", createdAt: 1_000 }));
    outboxStore.getState().upsert(makeRecord({ id: "b", createdAt: 2_000 }));
    outboxStore.getState().upsert(makeRecord({ id: "a", createdAt: 1_000, attempts: 2 }));
    const items = outboxStore.getState().items;
    expect(items.length).toBe(2);
    expect(items.find((r) => r.id === "a")?.attempts).toBe(2);
  });

  test("remove drops the record", () => {
    outboxStore.getState().upsert(makeRecord({ id: "a" }));
    outboxStore.getState().upsert(makeRecord({ id: "b", createdAt: 2_000 }));
    outboxStore.getState().remove("a");
    expect(outboxStore.getState().items.map((r) => r.id)).toEqual(["b"]);
  });

  test("countsOf splits pending vs error", () => {
    const counts = countsOf([
      makeRecord({ id: "a", state: "pending" }),
      makeRecord({ id: "b", state: "pending" }),
      makeRecord({ id: "c", state: "error" }),
    ]);
    expect(counts).toEqual({ pending: 2, error: 1 });
  });
});
