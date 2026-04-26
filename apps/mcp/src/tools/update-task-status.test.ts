import { updateTaskStatusOutputSchema } from "@remarks/mcp-schema";
import { describe, expect, it, vi } from "vitest";
import type { IdempotencyCache } from "../lib/idempotency.js";
import { McpToolError } from "../lib/mcp-error.js";
import type { AuthContext } from "../types/auth.js";
import type { ApiClient } from "./types.js";
import { updateTaskStatusHandler } from "./update-task-status.js";

const CLERK_USER_ID = "user_2abc123";
const STUB_AUTH: AuthContext = {
  clerkUserId: CLERK_USER_ID,
  scopes: ["tasks:read", "tasks:write", "project:read"],
  oauthClientName: "Claude Code",
};

const TASK_ID = "33333333-3333-4333-8333-333333333333";
const IDEMPOTENCY_KEY = "44444444-4444-4444-8444-444444444444";

function makeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    assertProjectAccess: vi.fn().mockResolvedValue(true),
    listAccessibleProjects: vi.fn().mockResolvedValue([]),
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

describe("updateTaskStatusHandler", () => {
  it("happy path: API called, output validated, idempotency not consulted without key", async () => {
    const updateAnnotationStatus = vi.fn().mockResolvedValue({
      id: TASK_ID,
      status: "doing",
      updatedAt: "2026-04-26T10:00:00.000Z",
    });
    const api = makeApi({ updateAnnotationStatus });
    const idempotency = makeIdempotency();

    const result = await updateTaskStatusHandler(
      { task_id: TASK_ID, status: "doing" },
      { auth: STUB_AUTH, api, idempotency, requestId: "req_test" }
    );

    expect(updateAnnotationStatus).toHaveBeenCalledWith(
      TASK_ID,
      CLERK_USER_ID,
      STUB_AUTH.oauthClientName,
      "doing",
      undefined
    );
    expect(idempotency.check).not.toHaveBeenCalled();
    expect(idempotency.store).not.toHaveBeenCalled();
    const parsed = updateTaskStatusOutputSchema.parse(result.structuredContent);
    expect(parsed).toEqual({
      id: TASK_ID,
      status: "doing",
      updated_at: "2026-04-26T10:00:00.000Z",
    });
  });

  it("idempotency miss: API called, response stored", async () => {
    const updateAnnotationStatus = vi.fn().mockResolvedValue({
      id: TASK_ID,
      status: "done",
      updatedAt: "2026-04-26T10:00:00.000Z",
    });
    const api = makeApi({ updateAnnotationStatus });
    const check = vi.fn().mockResolvedValue({ kind: "miss" });
    const store = vi.fn().mockResolvedValue(undefined);
    const idempotency = makeIdempotency({ check, store });

    await updateTaskStatusHandler(
      { task_id: TASK_ID, status: "done", idempotency_key: IDEMPOTENCY_KEY, note: "shipped" },
      { auth: STUB_AUTH, api, idempotency, requestId: "req_test" }
    );

    expect(check).toHaveBeenCalledWith({
      tool: "remarks_update_task_status",
      tokenId: CLERK_USER_ID,
      key: IDEMPOTENCY_KEY,
      payload: { task_id: TASK_ID, status: "done", note: "shipped" },
    });
    expect(updateAnnotationStatus).toHaveBeenCalled();
    expect(store).toHaveBeenCalledTimes(1);
  });

  it("idempotency hit: returns cached response without calling API", async () => {
    const updateAnnotationStatus = vi.fn();
    const api = makeApi({ updateAnnotationStatus });
    const cachedResponse = {
      id: TASK_ID,
      status: "done" as const,
      updated_at: "2026-04-26T09:00:00.000Z",
    };
    const idempotency = makeIdempotency({
      check: vi.fn().mockResolvedValue({ kind: "hit", response: cachedResponse }),
    });

    const result = await updateTaskStatusHandler(
      { task_id: TASK_ID, status: "done", idempotency_key: IDEMPOTENCY_KEY },
      { auth: STUB_AUTH, api, idempotency, requestId: "req_test" }
    );

    expect(updateAnnotationStatus).not.toHaveBeenCalled();
    expect(result.structuredContent).toEqual(cachedResponse);
  });

  it("idempotency conflict: throws CONFLICT", async () => {
    const idempotency = makeIdempotency({
      check: vi.fn().mockResolvedValue({ kind: "conflict" }),
    });

    await expect(
      updateTaskStatusHandler(
        { task_id: TASK_ID, status: "done", idempotency_key: IDEMPOTENCY_KEY },
        { auth: STUB_AUTH, api: makeApi(), idempotency, requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("API returns null → NOT_FOUND", async () => {
    const api = makeApi({ updateAnnotationStatus: vi.fn().mockResolvedValue(null) });

    await expect(
      updateTaskStatusHandler(
        { task_id: TASK_ID, status: "done" },
        { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("missing tasks:write scope → FORBIDDEN", async () => {
    const auth: AuthContext = { ...STUB_AUTH, scopes: ["tasks:read", "project:read"] };
    await expect(
      updateTaskStatusHandler(
        { task_id: TASK_ID, status: "done" },
        { auth, api: makeApi(), idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("invalid task_id → VALIDATION_ERROR", async () => {
    await expect(
      updateTaskStatusHandler(
        { task_id: "not-a-uuid", status: "done" },
        { auth: STUB_AUTH, api: makeApi(), idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("status: 'to_do' (not in agent enum) → VALIDATION_ERROR", async () => {
    await expect(
      updateTaskStatusHandler(
        { task_id: TASK_ID, status: "to_do" },
        { auth: STUB_AUTH, api: makeApi(), idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toBeInstanceOf(McpToolError);
  });
});
