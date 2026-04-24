import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  type OutboxRecord,
  __resetForTests,
  clear,
  enqueue,
  getOne,
  listAll,
  remove,
  requeue,
  update,
} from "./outbox-db";
import { makeCapture } from "./outbox-test-utils";

const ORG = "org_abc";
const PROJECT = "11111111-1111-4111-8111-111111111111";

async function seed(id: string, now: number): Promise<OutboxRecord> {
  return enqueue({
    id,
    clerkOrgId: ORG,
    projectId: PROJECT,
    payload: {
      branch: "main",
      capture: makeCapture(),
      commentText: `hi ${id}`,
    },
    now,
  });
}

beforeEach(async () => {
  indexedDB.deleteDatabase("remarks-outbox");
  __resetForTests();
});

afterEach(async () => {
  await clear().catch(() => {});
  __resetForTests();
});

describe("outbox-db", () => {
  test("enqueue writes a pending record with zero attempts", async () => {
    const record = await seed("rec-1", 100);
    expect(record.state).toBe("pending");
    expect(record.attempts).toBe(0);
    expect(record.lastError).toBeNull();
    expect(record.nextAttemptAt).toBe(100);
    expect(record.createdAt).toBe(100);

    const found = await getOne("rec-1");
    expect(found).not.toBeNull();
    expect(found?.payload.commentText).toBe("hi rec-1");
    expect(found?.payload.capture.kind).toBe("element");
  });

  test("listAll returns every persisted record", async () => {
    await seed("rec-1", 100);
    await seed("rec-2", 200);
    const all = await listAll();
    expect(all.map((r) => r.id).sort()).toEqual(["rec-1", "rec-2"]);
  });

  test("update overwrites fields in place", async () => {
    const rec = await seed("rec-1", 100);
    const updated: OutboxRecord = {
      ...rec,
      attempts: 2,
      lastError: { step: "create", message: "boom", status: 503 },
      lastAttemptAt: 500,
      nextAttemptAt: 530_000,
    };
    await update(updated);
    const found = await getOne("rec-1");
    expect(found?.attempts).toBe(2);
    expect(found?.lastError?.status).toBe(503);
    expect(found?.nextAttemptAt).toBe(530_000);
  });

  test("remove deletes a record", async () => {
    await seed("rec-1", 100);
    await remove("rec-1");
    expect(await getOne("rec-1")).toBeNull();
  });

  test("requeue resets attempts and nextAttemptAt on an errored record", async () => {
    const rec = await seed("rec-1", 100);
    await update({
      ...rec,
      state: "error",
      attempts: 3,
      lastError: { step: "put", message: "nope", status: 500 },
      nextAttemptAt: 9_999_999,
    });

    const requeued = await requeue("rec-1", 1_000);
    expect(requeued?.state).toBe("pending");
    expect(requeued?.attempts).toBe(0);
    expect(requeued?.lastError).toBeNull();
    expect(requeued?.nextAttemptAt).toBe(1_000);

    const persisted = await getOne("rec-1");
    expect(persisted?.state).toBe("pending");
  });

  test("requeue returns null when the record is missing", async () => {
    expect(await requeue("missing")).toBeNull();
  });

  test("clear wipes every record", async () => {
    await seed("rec-1", 100);
    await seed("rec-2", 200);
    await clear();
    expect(await listAll()).toEqual([]);
  });
});
