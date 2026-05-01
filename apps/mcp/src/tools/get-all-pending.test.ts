import { getAllPendingOutputSchema } from "@remarks/mcp-schema";
import { describe, expect, it, vi } from "vitest";
import type { IdempotencyCache } from "../lib/idempotency.js";
import type { AuthContext } from "../types/auth.js";
import { getAllPendingHandler } from "./get-all-pending.js";
import type { ApiClient } from "./types.js";

const CLERK_USER_ID = "user_2abc123";
const STUB_AUTH: AuthContext = {
  clerkUserId: CLERK_USER_ID,
  scopes: ["tasks:read", "tasks:write", "project:read"],
  oauthClientName: "Claude Code",
};

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

function makeIdempotency(): IdempotencyCache {
  return { check: vi.fn(), store: vi.fn() } as IdempotencyCache;
}

const PROJECT_ROW = {
  id: "33333333-3333-4333-8333-333333333333",
  projectId: "22222222-2222-4222-8222-222222222222",
  projectSlug: "acme",
  branchId: "44444444-4444-4444-8444-444444444444",
  branchName: "main",
  status: "to_do" as const,
  targetType: "element" as const,
  url: "https://example.test/page",
  targetSelector: "button.x",
  targetCoords: null,
  viewport: { width: 1280, height: 720, dpr: 1 },
  commentText: "fix this",
  author: {
    id: "55555555-5555-4555-8555-555555555555",
    name: "Alice",
    email: "alice@example.test",
    avatarUrl: null,
  },
  assets: [],
  createdAt: "2026-04-26T10:00:00.000Z",
  updatedAt: "2026-04-26T10:00:00.000Z",
};

const PERSONAL_ROW = {
  ...PROJECT_ROW,
  id: "88888888-8888-4888-8888-888888888888",
  projectId: null,
  projectSlug: null,
  branchId: null,
  branchName: null,
  status: "acknowledged" as const,
  url: "https://remarks.online/dashboard",
};

describe("getAllPendingHandler", () => {
  it("happy path: filters statuses, maps mixed personal + project rows", async () => {
    const fetchListAllAnnotations = vi.fn().mockResolvedValue({
      items: [PROJECT_ROW, PERSONAL_ROW],
      nextCursor: null,
    });
    const api = makeApi({ fetchListAllAnnotations });

    const result = await getAllPendingHandler(
      {},
      { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
    );

    expect(fetchListAllAnnotations).toHaveBeenCalledWith(CLERK_USER_ID, {
      statuses: ["to_do", "acknowledged"],
      limit: 20,
    });
    const parsed = getAllPendingOutputSchema.parse(result.structuredContent);
    expect(parsed.tasks).toHaveLength(2);
    expect(parsed.tasks[0]?.project).toEqual({ id: PROJECT_ROW.projectId, slug: "acme" });
    expect(parsed.tasks[1]?.project).toBeNull();
    expect(parsed.tasks[1]?.branch).toBeNull();
  });

  it("forwards cursor and limit", async () => {
    const fetchListAllAnnotations = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    const api = makeApi({ fetchListAllAnnotations });

    await getAllPendingHandler(
      { limit: 50, cursor: "next-page" },
      { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
    );

    expect(fetchListAllAnnotations).toHaveBeenCalledWith(CLERK_USER_ID, {
      statuses: ["to_do", "acknowledged"],
      limit: 50,
      cursor: "next-page",
    });
  });

  it("API returns null → INTERNAL", async () => {
    const api = makeApi({ fetchListAllAnnotations: vi.fn().mockResolvedValue(null) });
    await expect(
      getAllPendingHandler(
        {},
        { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("missing tasks:read scope → FORBIDDEN", async () => {
    const auth: AuthContext = { ...STUB_AUTH, scopes: ["tasks:write", "project:read"] };
    await expect(
      getAllPendingHandler(
        {},
        { auth, api: makeApi(), idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
