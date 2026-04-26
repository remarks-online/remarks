import { addTaskCommentOutputSchema } from "@remarks/mcp-schema";
import { describe, expect, it, vi } from "vitest";
import type { IdempotencyCache } from "../lib/idempotency.js";
import type { AuthContext } from "../types/auth.js";
import { addTaskCommentHandler } from "./add-task-comment.js";
import type { ApiClient } from "./types.js";

const STUB_AUTH: AuthContext = {
  tokenId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  scopes: ["tasks:read", "tasks:write", "project:read"],
};

const TASK_ID = "33333333-3333-4333-8333-333333333333";
const EVENT_ID = "55555555-5555-4555-8555-555555555555";
const IDEMPOTENCY_KEY = "44444444-4444-4444-8444-444444444444";

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

describe("addTaskCommentHandler", () => {
  it("happy path: returns event_id + created_at", async () => {
    const addAnnotationComment = vi.fn().mockResolvedValue({
      eventId: EVENT_ID,
      createdAt: "2026-04-26T10:00:00.000Z",
    });
    const api = makeApi({ addAnnotationComment });

    const result = await addTaskCommentHandler(
      { task_id: TASK_ID, comment: "Need clarification.", kind: "clarification_request" },
      { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
    );

    expect(addAnnotationComment).toHaveBeenCalledWith(
      TASK_ID,
      STUB_AUTH.projectId,
      STUB_AUTH.tokenId,
      "Need clarification.",
      "clarification_request"
    );
    const parsed = addTaskCommentOutputSchema.parse(result.structuredContent);
    expect(parsed).toEqual({
      event_id: EVENT_ID,
      created_at: "2026-04-26T10:00:00.000Z",
    });
  });

  it("kind is part of idempotency payload (different kinds = different payloads)", async () => {
    const check = vi.fn().mockResolvedValue({ kind: "miss" });
    const idempotency = makeIdempotency({ check });
    const api = makeApi({
      addAnnotationComment: vi.fn().mockResolvedValue({
        eventId: EVENT_ID,
        createdAt: "2026-04-26T10:00:00.000Z",
      }),
    });

    await addTaskCommentHandler(
      {
        task_id: TASK_ID,
        comment: "x",
        kind: "progress_update",
        idempotency_key: IDEMPOTENCY_KEY,
      },
      { auth: STUB_AUTH, api, idempotency, requestId: "req_test" }
    );

    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { task_id: TASK_ID, comment: "x", kind: "progress_update" },
      })
    );
  });

  it("API returns null → NOT_FOUND", async () => {
    const api = makeApi({ addAnnotationComment: vi.fn().mockResolvedValue(null) });
    await expect(
      addTaskCommentHandler(
        { task_id: TASK_ID, comment: "x" },
        { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("missing tasks:write scope → FORBIDDEN", async () => {
    const auth: AuthContext = { ...STUB_AUTH, scopes: ["tasks:read"] };
    await expect(
      addTaskCommentHandler(
        { task_id: TASK_ID, comment: "x" },
        { auth, api: makeApi(), idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("idempotency hit: returns cached response without calling API", async () => {
    const addAnnotationComment = vi.fn();
    const api = makeApi({ addAnnotationComment });
    const cached = { event_id: EVENT_ID, created_at: "2026-04-26T09:00:00.000Z" };
    const idempotency = makeIdempotency({
      check: vi.fn().mockResolvedValue({ kind: "hit", response: cached }),
    });

    const result = await addTaskCommentHandler(
      { task_id: TASK_ID, comment: "x", idempotency_key: IDEMPOTENCY_KEY },
      { auth: STUB_AUTH, api, idempotency, requestId: "req_test" }
    );

    expect(addAnnotationComment).not.toHaveBeenCalled();
    expect(result.structuredContent).toEqual(cached);
  });
});
