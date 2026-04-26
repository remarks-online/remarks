import { getTaskOutputSchema } from "@remarks/mcp-schema";
import { describe, expect, it, vi } from "vitest";
import type { IdempotencyCache } from "../lib/idempotency.js";
import { McpToolError } from "../lib/mcp-error.js";
import type { AuthContext } from "../types/auth.js";
import { getTaskHandler } from "./get-task.js";
import type { ApiClient } from "./types.js";

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "33333333-3333-4333-8333-333333333333";
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

const SAMPLE_PAYLOAD = {
  annotation: {
    id: TASK_ID,
    projectId: PROJECT_ID,
    branchId: "44444444-4444-4444-8444-444444444444",
    branchName: "feat/checkout",
    status: "to_do" as const,
    targetType: "element" as const,
    url: "https://example.test/checkout",
    targetSelector: "button.submit",
    targetCoords: null,
    viewport: { width: 1280, height: 720, dpr: 2 },
    commentText: "Use brand green",
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
        url: "https://r2.example/screenshot",
        contentType: "image/png",
      },
    ],
    createdAt: "2026-04-26T10:00:00.000Z",
    updatedAt: "2026-04-26T10:00:00.000Z",
    domContext: {
      tagName: "BUTTON",
      classes: ["primary"],
      computedStyles: { color: "rgb(0,0,255)" },
      ancestors: [{ tagName: "FORM", classes: ["checkout"] }],
    },
    frameworkHint: "react",
  },
  relatedTasks: [
    {
      id: "77777777-7777-4777-8777-777777777777",
      status: "to_do" as const,
      commentText: "Add a shadow on hover",
    },
  ],
};

describe("getTaskHandler", () => {
  it("returns full task context with snake_case projection", async () => {
    const fetchAnnotation = vi.fn().mockResolvedValue(SAMPLE_PAYLOAD);
    const api = makeApi({ fetchAnnotation });

    const result = await getTaskHandler(
      { task_id: TASK_ID },
      { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
    );

    expect(fetchAnnotation).toHaveBeenCalledWith(TASK_ID, CLERK_USER_ID);
    const parsed = getTaskOutputSchema.parse(result.structuredContent);
    expect(parsed.id).toBe(TASK_ID);
    expect(parsed.target).toEqual({ type: "element", selector: "button.submit" });
    expect(parsed.viewport).toEqual({ width: 1280, height: 720, dpr: 2 });
    expect(parsed.dom_context).toEqual({
      tag_name: "BUTTON",
      classes: ["primary"],
      computed_styles: { color: "rgb(0,0,255)" },
      ancestors: [{ tag_name: "FORM", classes: ["checkout"] }],
    });
    expect(parsed.framework_hint).toBe("react");
    expect(parsed.screenshot_url).toBe("https://r2.example/screenshot");
    expect(parsed.related_tasks).toHaveLength(1);
    const related = parsed.related_tasks[0];
    expect(related).toBeDefined();
    if (!related) throw new Error("expected related");
    expect(related.id).toBe("77777777-7777-4777-8777-777777777777");
    expect(related.comment_preview).toBe("Add a shadow on hover");
  });

  it("returns null screenshot_url when no screenshot asset", async () => {
    const noShot = {
      ...SAMPLE_PAYLOAD,
      annotation: { ...SAMPLE_PAYLOAD.annotation, assets: [] },
    };
    const api = makeApi({ fetchAnnotation: vi.fn().mockResolvedValue(noShot) });

    const result = await getTaskHandler(
      { task_id: TASK_ID },
      { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
    );
    const parsed = getTaskOutputSchema.parse(result.structuredContent);
    expect(parsed.screenshot_url).toBeNull();
  });

  it("throws NOT_FOUND when api returns null (cross-project or missing)", async () => {
    const api = makeApi({ fetchAnnotation: vi.fn().mockResolvedValue(null) });

    await expect(
      getTaskHandler(
        { task_id: TASK_ID },
        { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toBeInstanceOf(McpToolError);
  });

  it("VALIDATION_ERROR on malformed task_id", async () => {
    const api = makeApi();
    await expect(
      getTaskHandler(
        { task_id: "not-a-uuid" },
        {
          auth: STUB_AUTH,
          api,
          idempotency: makeIdempotency(),
          requestId: "req_test",
        }
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rectangle target with coords surfaces both type+coords", async () => {
    const rect = {
      annotation: {
        ...SAMPLE_PAYLOAD.annotation,
        targetType: "rectangle" as const,
        targetSelector: null,
        targetCoords: { x: 10, y: 20, width: 30, height: 40 },
      },
      relatedTasks: [],
    };
    const api = makeApi({ fetchAnnotation: vi.fn().mockResolvedValue(rect) });

    const result = await getTaskHandler(
      { task_id: TASK_ID },
      { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
    );
    const parsed = getTaskOutputSchema.parse(result.structuredContent);
    expect(parsed.target).toEqual({
      type: "rectangle",
      coords: { x: 10, y: 20, width: 30, height: 40 },
    });
  });
});
