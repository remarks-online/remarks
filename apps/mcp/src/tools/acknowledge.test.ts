import { acknowledgeOutputSchema } from "@remarks/mcp-schema";
import { describe, expect, it, vi } from "vitest";
import type { IdempotencyCache } from "../lib/idempotency.js";
import type { AuthContext } from "../types/auth.js";
import { acknowledgeHandler } from "./acknowledge.js";
import type { ApiClient } from "./types.js";

const CLERK_USER_ID = "user_2abc123";
const STUB_AUTH: AuthContext = {
  clerkUserId: CLERK_USER_ID,
  scopes: ["tasks:read", "tasks:write", "project:read"],
  oauthClientName: "Claude Code",
};

const TASK_ID = "33333333-3333-4333-8333-333333333333";
const COMMENT_EVENT_ID = "55555555-5555-4555-8555-555555555555";
const IDEMPOTENCY_KEY = "44444444-4444-4444-8444-444444444444";
const UPDATED_AT = "2026-05-01T10:00:00.000Z";

function makeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    assertProjectAccess: vi.fn().mockResolvedValue(true),
    listAccessibleProjects: vi.fn().mockResolvedValue([]),
    assertOrgAccess: vi.fn().mockResolvedValue(true),
    listAccessibleOrgs: vi.fn().mockResolvedValue([]),
    fetchWhoami: vi.fn(),
    fetchProjectContext: vi.fn(),
    fetchListAnnotations: vi.fn(),
    fetchListPersonalAnnotations: vi.fn(),
    fetchListOrgAnnotations: vi.fn(),
    fetchListAllAnnotations: vi.fn(),
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

describe("acknowledgeHandler", () => {
  it("happy path without comment: status flipped, no comment leg called", async () => {
    const updateAnnotationStatus = vi.fn().mockResolvedValue({
      id: TASK_ID,
      status: "acknowledged",
      updatedAt: UPDATED_AT,
    });
    const addAnnotationComment = vi.fn();
    const api = makeApi({ updateAnnotationStatus, addAnnotationComment });

    const result = await acknowledgeHandler(
      { task_id: TASK_ID },
      { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
    );

    expect(updateAnnotationStatus).toHaveBeenCalledWith(
      TASK_ID,
      CLERK_USER_ID,
      STUB_AUTH.oauthClientName,
      "acknowledged",
      undefined,
      undefined
    );
    expect(addAnnotationComment).not.toHaveBeenCalled();
    const parsed = acknowledgeOutputSchema.parse(result.structuredContent);
    expect(parsed).toEqual({
      id: TASK_ID,
      status: "acknowledged",
      updated_at: UPDATED_AT,
      comment_event_id: null,
    });
  });

  it("happy path with comment: defaults kind to clarification_request", async () => {
    const updateAnnotationStatus = vi.fn().mockResolvedValue({
      id: TASK_ID,
      status: "acknowledged",
      updatedAt: UPDATED_AT,
    });
    const addAnnotationComment = vi.fn().mockResolvedValue({
      eventId: COMMENT_EVENT_ID,
      createdAt: UPDATED_AT,
    });
    const api = makeApi({ updateAnnotationStatus, addAnnotationComment });

    const result = await acknowledgeHandler(
      { task_id: TASK_ID, comment: "got it, checking now" },
      { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
    );

    expect(addAnnotationComment).toHaveBeenCalledWith(
      TASK_ID,
      CLERK_USER_ID,
      STUB_AUTH.oauthClientName,
      "got it, checking now",
      "clarification_request"
    );
    const parsed = acknowledgeOutputSchema.parse(result.structuredContent);
    expect(parsed.comment_event_id).toBe(COMMENT_EVENT_ID);
  });

  it("happy path with explicit kind: passes through", async () => {
    const updateAnnotationStatus = vi.fn().mockResolvedValue({
      id: TASK_ID,
      status: "acknowledged",
      updatedAt: UPDATED_AT,
    });
    const addAnnotationComment = vi.fn().mockResolvedValue({
      eventId: COMMENT_EVENT_ID,
      createdAt: UPDATED_AT,
    });
    const api = makeApi({ updateAnnotationStatus, addAnnotationComment });

    await acknowledgeHandler(
      { task_id: TASK_ID, comment: "started", kind: "progress_update" },
      { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
    );

    expect(addAnnotationComment).toHaveBeenCalledWith(
      TASK_ID,
      CLERK_USER_ID,
      STUB_AUTH.oauthClientName,
      "started",
      "progress_update"
    );
  });

  it("idempotency hit: returns cached without calling API", async () => {
    const updateAnnotationStatus = vi.fn();
    const addAnnotationComment = vi.fn();
    const api = makeApi({ updateAnnotationStatus, addAnnotationComment });
    const cached = {
      id: TASK_ID,
      status: "acknowledged" as const,
      updated_at: UPDATED_AT,
      comment_event_id: null,
    };
    const idempotency = makeIdempotency({
      check: vi.fn().mockResolvedValue({ kind: "hit", response: cached }),
    });

    const result = await acknowledgeHandler(
      { task_id: TASK_ID, idempotency_key: IDEMPOTENCY_KEY },
      { auth: STUB_AUTH, api, idempotency, requestId: "req_test" }
    );

    expect(updateAnnotationStatus).not.toHaveBeenCalled();
    expect(addAnnotationComment).not.toHaveBeenCalled();
    expect(result.structuredContent).toEqual(cached);
  });

  it("idempotency conflict: throws CONFLICT", async () => {
    const idempotency = makeIdempotency({
      check: vi.fn().mockResolvedValue({ kind: "conflict" }),
    });
    await expect(
      acknowledgeHandler(
        { task_id: TASK_ID, idempotency_key: IDEMPOTENCY_KEY },
        { auth: STUB_AUTH, api: makeApi(), idempotency, requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("status update returns null → NOT_FOUND", async () => {
    const api = makeApi({ updateAnnotationStatus: vi.fn().mockResolvedValue(null) });
    await expect(
      acknowledgeHandler(
        { task_id: TASK_ID },
        { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("missing tasks:write scope → FORBIDDEN", async () => {
    const auth: AuthContext = { ...STUB_AUTH, scopes: ["tasks:read", "project:read"] };
    await expect(
      acknowledgeHandler(
        { task_id: TASK_ID },
        { auth, api: makeApi(), idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("kind without comment → VALIDATION_ERROR", async () => {
    await expect(
      acknowledgeHandler(
        { task_id: TASK_ID, kind: "progress_update" },
        { auth: STUB_AUTH, api: makeApi(), idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("comment leg null after status success → INTERNAL", async () => {
    const updateAnnotationStatus = vi.fn().mockResolvedValue({
      id: TASK_ID,
      status: "acknowledged",
      updatedAt: UPDATED_AT,
    });
    const addAnnotationComment = vi.fn().mockResolvedValue(null);
    const api = makeApi({ updateAnnotationStatus, addAnnotationComment });

    await expect(
      acknowledgeHandler(
        { task_id: TASK_ID, comment: "hello there" },
        { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
