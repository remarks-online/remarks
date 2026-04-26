import { whoamiOutputSchema } from "@remarks/mcp-schema";
import { describe, expect, it, vi } from "vitest";
import type { IdempotencyCache } from "../lib/idempotency.js";
import { McpToolError } from "../lib/mcp-error.js";
import type { AuthContext } from "../types/auth.js";
import type { ApiClient } from "./types.js";
import { whoamiHandler } from "./whoami.js";

const CLERK_USER_ID = "user_2abc123";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

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

describe("whoamiHandler", () => {
  it("returns user, projects, oauth client name, and version metadata on success", async () => {
    const fetchWhoami = vi.fn().mockResolvedValue({
      user: { id: USER_ID, email: "alice@example.com", name: "Alice" },
      projects: [{ id: PROJECT_ID, name: "Acme", slug: "acme" }],
    });
    const api = makeApi({ fetchWhoami });

    const result = await whoamiHandler(
      {},
      { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
    );

    expect(fetchWhoami).toHaveBeenCalledWith(CLERK_USER_ID);
    const parsed = whoamiOutputSchema.parse(result.structuredContent);
    expect(parsed.user).toEqual({ id: USER_ID, email: "alice@example.com", name: "Alice" });
    expect(parsed.projects).toEqual([{ id: PROJECT_ID, name: "Acme", slug: "acme" }]);
    expect(parsed.oauth_client_name).toBe("Claude Code");
    expect(parsed.granted_scopes).toEqual(STUB_AUTH.scopes);
    expect(parsed.server_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(parsed.skill_version).toBeTypeOf("string");
  });

  it("throws NOT_FOUND when api returns null", async () => {
    const api = makeApi({ fetchWhoami: vi.fn().mockResolvedValue(null) });
    await expect(
      whoamiHandler(
        {},
        { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toBeInstanceOf(McpToolError);
  });
});
