// End-to-end offline→online flow for task 1.28 at the unit layer.
//
// The §14 task 1.28 Done-when is "Kill network, create annotation, restore
// network, see it sync." This suite exercises that scenario deterministically
// against fake-indexeddb + mocked uploadAnnotation, without spinning up a
// Playwright extension. A real-browser verify spec is intentionally deferred
// to task 1.31 (happy-path E2E) — the `verify/` directory is scoped to MV3
// service-worker architecture tests per apps/extension/verify/README.md.

import "fake-indexeddb/auto";
import type { AnnotationResponse } from "@remarks/shared";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { __resetForTests, clear, enqueue, getOne, listAll } from "./outbox-db";
import { drainOutbox } from "./outbox-drain";
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
    url: "https://app.example.com/x",
    targetSelector: "button",
    targetCoords: null,
    viewport: { width: 1920, height: 1080, dpr: 2 },
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

beforeEach(() => {
  indexedDB.deleteDatabase("remarks-outbox");
  __resetForTests();
});

afterEach(async () => {
  await clear().catch(() => {});
  __resetForTests();
});

describe("offline → online flow", () => {
  test("record enqueued while offline drains cleanly once connectivity returns", async () => {
    // (1) User posts while offline. `uploadAnnotation` throws a network error
    //     (no status) — the outbox-first submit path writes the record first,
    //     and the immediate drain tick records an attempt.
    const offlineUpload = vi
      .fn()
      .mockRejectedValue(new UploadAnnotationError("presign", "Network error"));

    await enqueue({
      id: "offline-1",
      clerkOrgId: ORG,
      projectId: PROJECT,
      payload: { branch: "main", capture: makeCapture(), commentText: "offline note" },
      now: 1_000,
    });

    const offlineOutcomes = await drainOutbox({
      apiUrl: API,
      token: TOKEN,
      clerkOrgId: ORG,
      upload: offlineUpload,
      now: () => 2_000,
    });

    expect(offlineOutcomes).toEqual([{ id: "offline-1", kind: "retry", attempts: 1 }]);
    const afterOfflineDrain = await getOne("offline-1");
    expect(afterOfflineDrain?.state).toBe("pending");
    expect(afterOfflineDrain?.attempts).toBe(1);
    // Next eligible attempt should sit 30s out.
    expect(afterOfflineDrain?.nextAttemptAt).toBe(2_000 + 30_000);

    // (2) Sidebar reload simulation — hydrating from IDB still sees the
    //     queued record. This is the crash-safety property.
    const hydrated = await listAll();
    expect(hydrated.map((r) => r.id)).toEqual(["offline-1"]);

    // (3) User comes back online; upload now succeeds. Drain at a `now` past
    //     the record's `nextAttemptAt` so the eligibility filter passes.
    const onlineUpload = vi.fn().mockResolvedValue(validAnnotation());
    const onlineOutcomes = await drainOutbox({
      apiUrl: API,
      token: TOKEN,
      clerkOrgId: ORG,
      upload: onlineUpload,
      now: () => 2_000 + 30_000 + 1,
    });

    expect(onlineOutcomes).toEqual([
      { id: "offline-1", kind: "ok", annotation: expect.any(Object) },
    ]);
    expect(await getOne("offline-1")).toBeNull();
    expect(await listAll()).toEqual([]);

    // `uploadAnnotation` received the same payload the user composed offline.
    expect(onlineUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        token: TOKEN,
        projectId: PROJECT,
        branch: "main",
        commentText: "offline note",
      })
    );
  });

  test("three sequential offline attempts flip the record to error", async () => {
    await enqueue({
      id: "offline-1",
      clerkOrgId: ORG,
      projectId: PROJECT,
      payload: { branch: "main", capture: makeCapture(), commentText: "persistent failure" },
      now: 1_000,
    });
    const upload = vi.fn().mockRejectedValue(new UploadAnnotationError("create", "down", 503));

    // Three eligible drain ticks — each one past the last nextAttemptAt.
    await drainOutbox({
      apiUrl: API,
      token: TOKEN,
      clerkOrgId: ORG,
      upload,
      now: () => 2_000,
    });
    await drainOutbox({
      apiUrl: API,
      token: TOKEN,
      clerkOrgId: ORG,
      upload,
      now: () => 2_000 + 30_000 + 1,
    });
    const final = await drainOutbox({
      apiUrl: API,
      token: TOKEN,
      clerkOrgId: ORG,
      upload,
      now: () => 2_000 + 60_000 + 2,
    });

    expect(final).toEqual([{ id: "offline-1", kind: "error", attempts: 3 }]);
    const persisted = await getOne("offline-1");
    expect(persisted?.state).toBe("error");
    expect(persisted?.lastError?.status).toBe(503);
  });
});
