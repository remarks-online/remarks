import { batchUpdateStatusOutputSchema } from "@remarks/mcp-schema";
import { describe, expect, it, vi } from "vitest";
import type { IdempotencyCache } from "../lib/idempotency.js";
import type { AuthContext } from "../types/auth.js";
import { batchUpdateStatusHandler } from "./batch-update-status.js";
import type { ApiClient } from "./types.js";

const STUB_AUTH: AuthContext = {
  tokenId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  scopes: ["tasks:read", "tasks:write", "project:read"],
};

const TASK_A = "33333333-3333-4333-8333-333333333333";
const TASK_B = "44444444-4444-4444-8444-444444444444";
const TASK_C = "55555555-5555-4555-8555-555555555555";
const IDEMPOTENCY_KEY = "66666666-6666-4666-8666-666666666666";

function makeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    fetchWhoami: vi.fn(),
    fetchProjectContext: vi.fn(),
    fetchListAnnotations: vi.fn(),
    fetchAnnotation: vi.fn(),
    updateAnnotationStatus: vi.fn(),
    addAnnotationComment: vi.fn(),
    ...overrides,
  } as ApiClient;
}

function makeIdempotency(overrides: Partial<IdempotencyCache> = {}): IdempotencyCache {
  return {
    check: vi.fn().mockResolvedValue({ kind: "miss" }),
    store: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as IdempotencyCache;
}

describe("batchUpdateStatusHandler", () => {
  it("returns success/error per task in input order with mixed outcomes", async () => {
    // Per-task fetcher response keyed on the task_id arg so we can drive a
    // mixed batch: success / not-found (null) / rejected (transport error).
    const updateAnnotationStatus = vi.fn().mockImplementation(async (taskId: string) => {
      if (taskId === TASK_A) {
        return { id: TASK_A, status: "done", updatedAt: "2026-04-26T10:00:00.000Z" };
      }
      if (taskId === TASK_B) return null;
      throw new Error("Internal API blew up");
    });
    const api = makeApi({ updateAnnotationStatus });

    const result = await batchUpdateStatusHandler(
      {
        updates: [
          { task_id: TASK_A, status: "done" },
          { task_id: TASK_B, status: "done" },
          { task_id: TASK_C, status: "done" },
        ],
      },
      { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
    );

    const parsed = batchUpdateStatusOutputSchema.parse(result.structuredContent);
    expect(parsed.results).toHaveLength(3);
    expect(parsed.results[0]).toEqual({ task_id: TASK_A, success: true });
    expect(parsed.results[1]).toEqual({
      task_id: TASK_B,
      success: false,
      error: "Task not found",
    });
    expect(parsed.results[2]?.success).toBe(false);
    expect(parsed.results[2]?.error).toBe("Internal API blew up");
  });

  it("idempotency hit: returns cached results without calling API", async () => {
    const updateAnnotationStatus = vi.fn();
    const cached = {
      results: [
        { task_id: TASK_A, success: true },
        { task_id: TASK_B, success: false, error: "Task not found" },
      ],
    };
    const idempotency = makeIdempotency({
      check: vi.fn().mockResolvedValue({ kind: "hit", response: cached }),
    });

    const result = await batchUpdateStatusHandler(
      {
        updates: [
          { task_id: TASK_A, status: "done" },
          { task_id: TASK_B, status: "done" },
        ],
        idempotency_key: IDEMPOTENCY_KEY,
      },
      {
        auth: STUB_AUTH,
        api: makeApi({ updateAnnotationStatus }),
        idempotency,
        requestId: "req_test",
      }
    );

    expect(updateAnnotationStatus).not.toHaveBeenCalled();
    expect(result.structuredContent).toEqual(cached);
  });

  it("idempotency conflict: throws CONFLICT", async () => {
    const idempotency = makeIdempotency({
      check: vi.fn().mockResolvedValue({ kind: "conflict" }),
    });
    await expect(
      batchUpdateStatusHandler(
        {
          updates: [{ task_id: TASK_A, status: "done" }],
          idempotency_key: IDEMPOTENCY_KEY,
        },
        { auth: STUB_AUTH, api: makeApi(), idempotency, requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("missing tasks:write scope → FORBIDDEN", async () => {
    const auth: AuthContext = { ...STUB_AUTH, scopes: ["tasks:read"] };
    await expect(
      batchUpdateStatusHandler(
        { updates: [{ task_id: TASK_A, status: "done" }] },
        { auth, api: makeApi(), idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("empty updates array → VALIDATION_ERROR", async () => {
    await expect(
      batchUpdateStatusHandler(
        { updates: [] },
        {
          auth: STUB_AUTH,
          api: makeApi(),
          idempotency: makeIdempotency(),
          requestId: "req_test",
        }
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("51 updates → VALIDATION_ERROR", async () => {
    const updates = Array.from({ length: 51 }, (_, i) => ({
      task_id: `${i.toString().padStart(8, "0")}-0000-4000-8000-000000000000`,
      status: "done" as const,
    }));
    await expect(
      batchUpdateStatusHandler(
        { updates },
        {
          auth: STUB_AUTH,
          api: makeApi(),
          idempotency: makeIdempotency(),
          requestId: "req_test",
        }
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
