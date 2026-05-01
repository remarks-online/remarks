import { getPendingOutputSchema } from "@remarks/mcp-schema";
import { describe, expect, it, vi } from "vitest";
import type { IdempotencyCache } from "../lib/idempotency.js";
import type { AuthContext } from "../types/auth.js";
import { getPendingHandler } from "./get-pending.js";
import type { ApiClient } from "./types.js";

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "33333333-3333-4333-8333-333333333333";
const STUB_AUTH: AuthContext = {
  clerkUserId: "user_2abc123",
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

const SAMPLE_ROW = {
  id: TASK_ID,
  projectId: PROJECT_ID,
  projectSlug: "acme",
  branchId: "44444444-4444-4444-8444-444444444444",
  branchName: "main",
  status: "to_do" as const,
  targetType: "element" as const,
  url: "https://example.test/page",
  targetSelector: "button.x",
  targetCoords: null,
  viewport: { width: 1280, height: 720, dpr: 1 },
  commentText: "make this button blue",
  author: {
    id: "55555555-5555-4555-8555-555555555555",
    name: "Alice",
    email: "alice@example.test",
    avatarUrl: null,
  },
  assets: [
    {
      id: "66666666-6666-4666-8666-666666666666",
      kind: "screenshot" as const,
      url: "https://r2.example/sig",
      contentType: "image/png",
    },
  ],
  createdAt: "2026-04-26T10:00:00.000Z",
  updatedAt: "2026-04-26T10:00:00.000Z",
};

describe("getPendingHandler", () => {
  it("happy path: filters to to_do + acknowledged, maps rows", async () => {
    const fetchListAnnotations = vi.fn().mockResolvedValue({
      items: [SAMPLE_ROW],
      nextCursor: null,
    });
    const api = makeApi({ fetchListAnnotations });

    const result = await getPendingHandler(
      { project_id: PROJECT_ID },
      { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
    );

    expect(fetchListAnnotations).toHaveBeenCalledWith(PROJECT_ID, {
      statuses: ["to_do", "acknowledged"],
      limit: 20,
    });
    const parsed = getPendingOutputSchema.parse(result.structuredContent);
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0]).toMatchObject({
      id: TASK_ID,
      status: "to_do",
      branch: "main",
      project: { id: PROJECT_ID, slug: "acme" },
    });
  });

  it("forwards branch and cursor params", async () => {
    const fetchListAnnotations = vi.fn().mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    const api = makeApi({ fetchListAnnotations });

    await getPendingHandler(
      { project_id: PROJECT_ID, branch: "feature/x", cursor: "abc", limit: 50 },
      { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
    );

    expect(fetchListAnnotations).toHaveBeenCalledWith(PROJECT_ID, {
      statuses: ["to_do", "acknowledged"],
      limit: 50,
      branch: "feature/x",
      cursor: "abc",
    });
  });

  it("non-member project (assertProjectAccess returns false) → NOT_FOUND", async () => {
    const api = makeApi({
      assertProjectAccess: vi.fn().mockResolvedValue(false),
      fetchListAnnotations: vi.fn(),
    });
    await expect(
      getPendingHandler(
        { project_id: PROJECT_ID },
        { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("API returns null → NOT_FOUND", async () => {
    const api = makeApi({ fetchListAnnotations: vi.fn().mockResolvedValue(null) });
    await expect(
      getPendingHandler(
        { project_id: PROJECT_ID },
        { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("missing tasks:read scope → FORBIDDEN", async () => {
    const auth: AuthContext = { ...STUB_AUTH, scopes: ["tasks:write", "project:read"] };
    await expect(
      getPendingHandler(
        { project_id: PROJECT_ID },
        { auth, api: makeApi(), idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
