import "fake-indexeddb/auto";
import type { AnnotationResponse } from "@remarks/shared";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { type OutboxRecord, __resetForTests, clear, enqueue, getOne, listAll } from "./outbox-db";
import { DRAIN_INTERVAL_MS, drainOutbox } from "./outbox-drain";
import { makeCapture } from "./outbox-test-utils";
import { UploadAnnotationError } from "./upload-annotation";

const ORG = "org_abc";
const PROJECT = "11111111-1111-4111-8111-111111111111";
const API = "https://api.remarks.test";
const TOKEN = "test-token";

function validAnnotation(): AnnotationResponse {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    projectId: PROJECT,
    projectSlug: "acme",
    branchId: "11111111-3333-4333-8444-555555555555",
    branchName: "main",
    status: "to_do",
    targetType: "element",
    intent: null,
    severity: null,
    url: "https://app.example.com/x",
    targetSelector: "button",
    targetCoords: null,
    viewport: { width: 1920, height: 1080, dpr: 2 },
    domContext: null,
    commentText: "hi",
    author: {
      id: "11111111-4444-4333-8444-555555555555",
      name: "Alice",
      email: "alice@example.com",
      avatarUrl: null,
    },
    assets: [],
    createdAt: "2026-04-24T00:00:00.000Z",
    updatedAt: "2026-04-24T00:00:00.000Z",
  };
}

async function seed(overrides: Partial<OutboxRecord> = {}): Promise<OutboxRecord> {
  const rec = await enqueue({
    id: overrides.id ?? "rec-1",
    clerkOrgId: overrides.clerkOrgId ?? ORG,
    projectId: overrides.projectId ?? PROJECT,
    payload: overrides.payload ?? {
      branch: "main",
      capture: makeCapture(),
      commentText: "hi",
    },
    now: overrides.createdAt ?? 1_000,
  });
  if (Object.keys(overrides).length > 0) {
    const merged: OutboxRecord = { ...rec, ...overrides };
    // Re-persist so fields like `state`, `nextAttemptAt`, etc. apply.
    const { update } = await import("./outbox-db");
    await update(merged);
    return merged;
  }
  return rec;
}

beforeEach(() => {
  indexedDB.deleteDatabase("remarks-outbox");
  __resetForTests();
});

afterEach(async () => {
  await clear().catch(() => {});
  __resetForTests();
});

describe("drainOutbox", () => {
  test("no-op when token is null", async () => {
    await seed();
    const upload = vi.fn();
    const outcomes = await drainOutbox({
      apiUrl: API,
      token: null,
      clerkOrgId: ORG,
      upload,
      now: () => 10_000,
    });
    expect(outcomes).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
  });

  test("success removes the record", async () => {
    await seed();
    const upload = vi.fn().mockResolvedValue(validAnnotation());
    const outcomes = await drainOutbox({
      apiUrl: API,
      token: TOKEN,
      clerkOrgId: ORG,
      upload,
      now: () => 10_000,
    });
    expect(outcomes).toEqual([{ id: "rec-1", kind: "ok", annotation: expect.any(Object) }]);
    expect(await getOne("rec-1")).toBeNull();
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({
        token: TOKEN,
        apiUrl: API,
        projectId: PROJECT,
        branch: "main",
      })
    );
  });

  test("retryable failure bumps attempts and pushes nextAttemptAt by 30s", async () => {
    await seed();
    const upload = vi.fn().mockRejectedValue(new UploadAnnotationError("create", "boom", 503));
    const outcomes = await drainOutbox({
      apiUrl: API,
      token: TOKEN,
      clerkOrgId: ORG,
      upload,
      now: () => 10_000,
    });
    expect(outcomes).toEqual([{ id: "rec-1", kind: "retry", attempts: 1 }]);
    const persisted = await getOne("rec-1");
    expect(persisted?.state).toBe("pending");
    expect(persisted?.attempts).toBe(1);
    expect(persisted?.nextAttemptAt).toBe(10_000 + DRAIN_INTERVAL_MS);
    expect(persisted?.lastError).toEqual({
      step: "create",
      message: "boom",
      status: 503,
    });
  });

  test("third retryable failure flips state to error", async () => {
    await seed({ attempts: 2 });
    const upload = vi.fn().mockRejectedValue(new UploadAnnotationError("put", "fail again", 500));
    const outcomes = await drainOutbox({
      apiUrl: API,
      token: TOKEN,
      clerkOrgId: ORG,
      upload,
      now: () => 10_000,
    });
    expect(outcomes).toEqual([{ id: "rec-1", kind: "error", attempts: 3 }]);
    const persisted = await getOne("rec-1");
    expect(persisted?.state).toBe("error");
    expect(persisted?.attempts).toBe(3);
  });

  test("non-retryable failure flips state to error immediately", async () => {
    await seed();
    const upload = vi
      .fn()
      .mockRejectedValue(new UploadAnnotationError("create", "validation", 400));
    const outcomes = await drainOutbox({
      apiUrl: API,
      token: TOKEN,
      clerkOrgId: ORG,
      upload,
      now: () => 10_000,
    });
    expect(outcomes).toEqual([{ id: "rec-1", kind: "error", attempts: 1 }]);
    const persisted = await getOne("rec-1");
    expect(persisted?.state).toBe("error");
  });

  test("records with nextAttemptAt in the future are skipped", async () => {
    await seed({ nextAttemptAt: 20_000 });
    const upload = vi.fn().mockResolvedValue(validAnnotation());
    const outcomes = await drainOutbox({
      apiUrl: API,
      token: TOKEN,
      clerkOrgId: ORG,
      upload,
      now: () => 10_000,
    });
    expect(outcomes).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
    expect(await getOne("rec-1")).not.toBeNull();
  });

  test("records for another org are skipped", async () => {
    await seed({ clerkOrgId: "org_other" });
    const upload = vi.fn().mockResolvedValue(validAnnotation());
    const outcomes = await drainOutbox({
      apiUrl: API,
      token: TOKEN,
      clerkOrgId: ORG,
      upload,
      now: () => 10_000,
    });
    expect(outcomes).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
  });

  test("error-state records are not retried automatically", async () => {
    await seed({ state: "error", attempts: 3 });
    const upload = vi.fn().mockResolvedValue(validAnnotation());
    const outcomes = await drainOutbox({
      apiUrl: API,
      token: TOKEN,
      clerkOrgId: ORG,
      upload,
      now: () => 10_000,
    });
    expect(outcomes).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
  });

  test("onOutcome fires for every processed record", async () => {
    await seed({ id: "a" });
    await seed({ id: "b", createdAt: 2_000 });
    const upload = vi.fn().mockResolvedValue(validAnnotation());
    const onOutcome = vi.fn();
    await drainOutbox({
      apiUrl: API,
      token: TOKEN,
      clerkOrgId: ORG,
      upload,
      now: () => 10_000,
      onOutcome,
    });
    expect(onOutcome).toHaveBeenCalledTimes(2);
    expect(await listAll()).toEqual([]);
  });
});
