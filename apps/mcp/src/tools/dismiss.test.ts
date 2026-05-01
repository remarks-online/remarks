import { dismissOutputSchema } from "@remarks/mcp-schema";
import { describe, expect, it, vi } from "vitest";
import type { IdempotencyCache } from "../lib/idempotency.js";
import type { AuthContext } from "../types/auth.js";
import { dismissHandler } from "./dismiss.js";
import type { ApiClient } from "./types.js";

const CLERK_USER_ID = "user_2abc123";
const STUB_AUTH: AuthContext = {
  clerkUserId: CLERK_USER_ID,
  scopes: ["tasks:read", "tasks:write", "project:read"],
  oauthClientName: "Claude Code",
};

const TASK_ID = "33333333-3333-4333-8333-333333333333";
const IDEMPOTENCY_KEY = "44444444-4444-4444-8444-444444444444";
const UPDATED_AT = "2026-05-01T10:00:00.000Z";
const VALID_REASON = "out of scope for this branch";

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

describe("dismissHandler", () => {
  it("happy path: API called with rejected + reason as note", async () => {
    const updateAnnotationStatus = vi.fn().mockResolvedValue({
      id: TASK_ID,
      status: "rejected",
      updatedAt: UPDATED_AT,
    });
    const api = makeApi({ updateAnnotationStatus });

    const result = await dismissHandler(
      { task_id: TASK_ID, reason: VALID_REASON },
      { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
    );

    expect(updateAnnotationStatus).toHaveBeenCalledWith(
      TASK_ID,
      CLERK_USER_ID,
      STUB_AUTH.oauthClientName,
      "rejected",
      undefined,
      VALID_REASON
    );
    const parsed = dismissOutputSchema.parse(result.structuredContent);
    expect(parsed).toEqual({
      id: TASK_ID,
      status: "rejected",
      updated_at: UPDATED_AT,
    });
  });

  it("reason with 9 chars → VALIDATION_ERROR before API call", async () => {
    const updateAnnotationStatus = vi.fn();
    const api = makeApi({ updateAnnotationStatus });

    await expect(
      dismissHandler(
        { task_id: TASK_ID, reason: "too short" },
        { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(updateAnnotationStatus).not.toHaveBeenCalled();
  });

  it("idempotency hit: returns cached without API call", async () => {
    const updateAnnotationStatus = vi.fn();
    const api = makeApi({ updateAnnotationStatus });
    const cached = {
      id: TASK_ID,
      status: "rejected" as const,
      updated_at: UPDATED_AT,
    };
    const idempotency = makeIdempotency({
      check: vi.fn().mockResolvedValue({ kind: "hit", response: cached }),
    });

    const result = await dismissHandler(
      { task_id: TASK_ID, reason: VALID_REASON, idempotency_key: IDEMPOTENCY_KEY },
      { auth: STUB_AUTH, api, idempotency, requestId: "req_test" }
    );

    expect(updateAnnotationStatus).not.toHaveBeenCalled();
    expect(result.structuredContent).toEqual(cached);
  });

  it("idempotency conflict: throws CONFLICT", async () => {
    const idempotency = makeIdempotency({
      check: vi.fn().mockResolvedValue({ kind: "conflict" }),
    });
    await expect(
      dismissHandler(
        { task_id: TASK_ID, reason: VALID_REASON, idempotency_key: IDEMPOTENCY_KEY },
        { auth: STUB_AUTH, api: makeApi(), idempotency, requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("API returns null → NOT_FOUND", async () => {
    const api = makeApi({ updateAnnotationStatus: vi.fn().mockResolvedValue(null) });
    await expect(
      dismissHandler(
        { task_id: TASK_ID, reason: VALID_REASON },
        { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("missing tasks:write scope → FORBIDDEN", async () => {
    const auth: AuthContext = { ...STUB_AUTH, scopes: ["tasks:read", "project:read"] };
    await expect(
      dismissHandler(
        { task_id: TASK_ID, reason: VALID_REASON },
        { auth, api: makeApi(), idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
