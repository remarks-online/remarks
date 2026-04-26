import { listTasksOutputSchema } from "@remarks/mcp-schema";
import { describe, expect, it, vi } from "vitest";
import type { IdempotencyCache } from "../lib/idempotency.js";
import { McpToolError } from "../lib/mcp-error.js";
import type { AuthContext } from "../types/auth.js";
import { listTasksHandler } from "./list-tasks.js";
import type { ApiClient } from "./types.js";

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const STUB_AUTH: AuthContext = {
  tokenId: "11111111-1111-4111-8111-111111111111",
  projectId: PROJECT_ID,
  scopes: ["tasks:read", "project:read"],
};
const TASK_ID = "33333333-3333-4333-8333-333333333333";
const BRANCH_ID = "44444444-4444-4444-8444-444444444444";

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

function makeIdempotency(): IdempotencyCache {
  return { check: vi.fn(), store: vi.fn() } as IdempotencyCache;
}

const SAMPLE_ROW = {
  id: TASK_ID,
  projectId: PROJECT_ID,
  branchId: BRANCH_ID,
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

describe("listTasksHandler", () => {
  it("defaults to to_do+doing when status omitted, projects to snake_case", async () => {
    const fetchListAnnotations = vi
      .fn()
      .mockResolvedValue({ items: [SAMPLE_ROW], nextCursor: null });
    const api = makeApi({ fetchListAnnotations });

    const result = await listTasksHandler(
      { project_id: PROJECT_ID },
      { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
    );

    expect(fetchListAnnotations).toHaveBeenCalledWith(PROJECT_ID, {
      limit: 20,
      statuses: ["to_do", "doing"],
    });
    const parsed = listTasksOutputSchema.parse(result.structuredContent);
    expect(parsed.tasks).toHaveLength(1);
    const task = parsed.tasks[0];
    expect(task).toBeDefined();
    if (!task) throw new Error("expected task");
    expect(task).toEqual({
      id: TASK_ID,
      status: "to_do",
      branch: "main",
      url: "https://example.test/page",
      target_type: "element",
      comment_preview: "make this button blue",
      author: { name: "Alice", email: "alice@example.test" },
      created_at: "2026-04-26T10:00:00.000Z",
      has_screenshot: true,
    });
    expect(parsed.next_cursor).toBeNull();
  });

  it("passes branch and explicit statuses through to the API", async () => {
    const fetchListAnnotations = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    const api = makeApi({ fetchListAnnotations });

    await listTasksHandler(
      {
        project_id: PROJECT_ID,
        branch: "feat/x",
        status: ["done"],
        limit: 5,
        cursor: "abc",
      },
      { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
    );

    expect(fetchListAnnotations).toHaveBeenCalledWith(PROJECT_ID, {
      limit: 5,
      statuses: ["done"],
      branch: "feat/x",
      cursor: "abc",
    });
  });

  it("status=[] means no status filter", async () => {
    const fetchListAnnotations = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    const api = makeApi({ fetchListAnnotations });

    await listTasksHandler(
      { project_id: PROJECT_ID, status: [] },
      { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
    );
    const call = fetchListAnnotations.mock.calls[0];
    expect(call?.[1].statuses).toBeUndefined();
  });

  it("rejects cross-project access with NOT_FOUND, never calls api", async () => {
    const fetchListAnnotations = vi.fn();
    const api = makeApi({ fetchListAnnotations });

    await expect(
      listTasksHandler(
        { project_id: "99999999-9999-4999-8999-999999999999" },
        { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fetchListAnnotations).not.toHaveBeenCalled();
  });

  it("VALIDATION_ERROR for malformed input", async () => {
    const api = makeApi();
    await expect(
      listTasksHandler(
        { project_id: "not-a-uuid" },
        {
          auth: STUB_AUTH,
          api,
          idempotency: makeIdempotency(),
          requestId: "req_test",
        }
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("throws NOT_FOUND if api returns null", async () => {
    const api = makeApi({ fetchListAnnotations: vi.fn().mockResolvedValue(null) });
    await expect(
      listTasksHandler(
        { project_id: PROJECT_ID },
        {
          auth: STUB_AUTH,
          api,
          idempotency: makeIdempotency(),
          requestId: "req_test",
        }
      )
    ).rejects.toBeInstanceOf(McpToolError);
  });

  it("falsy author email falls back without throwing", async () => {
    const fetchListAnnotations = vi.fn().mockResolvedValue({
      items: [
        {
          ...SAMPLE_ROW,
          author: { ...SAMPLE_ROW.author, name: null, email: null },
        },
      ],
      nextCursor: null,
    });
    const api = makeApi({ fetchListAnnotations });

    const result = await listTasksHandler(
      { project_id: PROJECT_ID },
      { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
    );
    const parsed = listTasksOutputSchema.parse(result.structuredContent);
    const author = parsed.tasks[0]?.author;
    expect(author).toBeDefined();
    if (!author) throw new Error("expected author");
    expect(author.name).toBe("Unknown");
    expect(author.email).toBe("");
  });
});
