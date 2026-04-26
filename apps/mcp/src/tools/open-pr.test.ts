import { openPrOutputSchema } from "@remarks/mcp-schema";
import { describe, expect, it, vi } from "vitest";
import type { IdempotencyCache } from "../lib/idempotency.js";
import type { AuthContext } from "../types/auth.js";
import { openPrHandler } from "./open-pr.js";
import type { ApiClient } from "./types.js";

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const STUB_AUTH: AuthContext = {
  clerkUserId: "user_2abc123",
  scopes: ["tasks:read", "tasks:write", "project:read"],
  oauthClientName: "Claude Code",
};

const TASK_ID = "33333333-3333-4333-8333-333333333333";

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
  return {
    check: vi.fn(),
    store: vi.fn(),
  } as IdempotencyCache;
}

describe("openPrHandler", () => {
  it("returns deterministic pending response on a project the user can access", async () => {
    const api = makeApi();
    const idempotency = makeIdempotency();
    const result = await openPrHandler(
      {
        project_id: PROJECT_ID,
        task_ids: [TASK_ID],
        branch: "feat/something",
      },
      { auth: STUB_AUTH, api, idempotency, requestId: "req_test" }
    );

    const parsed = openPrOutputSchema.parse(result.structuredContent);
    expect(parsed.status).toBe("pending_github_integration");
    expect(parsed.pr_url).toBeNull();
    expect(parsed.message.length).toBeGreaterThan(0);

    // Stub does not touch the API or the cache.
    expect(api.updateAnnotationStatus).not.toHaveBeenCalled();
    expect(api.addAnnotationComment).not.toHaveBeenCalled();
    expect(idempotency.check).not.toHaveBeenCalled();
    expect(idempotency.store).not.toHaveBeenCalled();
  });

  it("cross-project project_id → NOT_FOUND", async () => {
    const api = makeApi({ assertProjectAccess: vi.fn().mockResolvedValue(false) });
    await expect(
      openPrHandler(
        {
          project_id: "00000000-0000-4000-8000-000000000000",
          task_ids: [TASK_ID],
          branch: "feat/x",
        },
        { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("missing tasks:write scope → FORBIDDEN", async () => {
    const auth: AuthContext = { ...STUB_AUTH, scopes: ["tasks:read"] };
    await expect(
      openPrHandler(
        {
          project_id: PROJECT_ID,
          task_ids: [TASK_ID],
          branch: "feat/x",
        },
        { auth, api: makeApi(), idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("empty task_ids → VALIDATION_ERROR", async () => {
    await expect(
      openPrHandler(
        { project_id: PROJECT_ID, task_ids: [], branch: "feat/x" },
        { auth: STUB_AUTH, api: makeApi(), idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
