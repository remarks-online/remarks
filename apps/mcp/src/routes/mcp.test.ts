import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the JWT verifier and the api-client surface so tests don't reach
// Clerk's network or our internal API. Auth plugin behavior (challenge
// header shape, missing-token branch) is covered in unit tests; here we
// just need a happy-path verifier to push past the auth hook so we can
// exercise the route + tool wiring end-to-end.
const mocks = vi.hoisted(() => ({
  verifyOAuthToken: vi.fn(),
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  assertProjectAccess: vi.fn(),
  listAccessibleProjects: vi.fn(),
  assertOrgAccess: vi.fn(),
  listAccessibleOrgs: vi.fn(),
  fetchWhoami: vi.fn(),
  fetchProjectContext: vi.fn(),
  fetchListAnnotations: vi.fn(),
  fetchListPersonalAnnotations: vi.fn(),
  fetchListOrgAnnotations: vi.fn(),
  fetchAnnotation: vi.fn(),
  updateAnnotationStatus: vi.fn(),
  addAnnotationComment: vi.fn(),
}));

vi.mock("../lib/jwt.js", () => ({
  verifyOAuthToken: mocks.verifyOAuthToken,
}));

vi.mock("../lib/redis.js", () => ({
  redis: { get: mocks.redisGet, set: mocks.redisSet },
}));

vi.mock("../lib/api-client.js", () => ({
  assertProjectAccess: mocks.assertProjectAccess,
  listAccessibleProjects: mocks.listAccessibleProjects,
  assertOrgAccess: mocks.assertOrgAccess,
  listAccessibleOrgs: mocks.listAccessibleOrgs,
  fetchWhoami: mocks.fetchWhoami,
  fetchProjectContext: mocks.fetchProjectContext,
  fetchListAnnotations: mocks.fetchListAnnotations,
  fetchListPersonalAnnotations: mocks.fetchListPersonalAnnotations,
  fetchListOrgAnnotations: mocks.fetchListOrgAnnotations,
  fetchAnnotation: mocks.fetchAnnotation,
  updateAnnotationStatus: mocks.updateAnnotationStatus,
  addAnnotationComment: mocks.addAnnotationComment,
}));

const { buildServer } = await import("../server.js");

const CLERK_USER_ID = "user_2abc123";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const STUB_VERIFIED = {
  clerkUserId: CLERK_USER_ID,
  scopes: ["tasks:read", "tasks:write", "project:read"],
  oauthClientName: "Claude Code",
};

// Streamable HTTP either returns plain JSON or text/event-stream encoding the
// JSON-RPC envelope. Both paths put the result on the same logical message;
// this helper extracts it.
function parseJsonRpcResponse(body: string): { result?: unknown; error?: unknown } {
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object" && ("result" in parsed || "error" in parsed)) {
      return parsed as { result?: unknown; error?: unknown };
    }
  } catch {
    // Fall through to SSE parsing.
  }
  const dataLines = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  for (let i = dataLines.length - 1; i >= 0; i--) {
    const raw = dataLines[i];
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && ("result" in parsed || "error" in parsed)) {
        return parsed as { result?: unknown; error?: unknown };
      }
    } catch {
      // ignore malformed events
    }
  }
  throw new Error(`Could not extract JSON-RPC response from body: ${body.slice(0, 200)}`);
}

describe("POST /mcp", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    mocks.verifyOAuthToken.mockReset();
    mocks.assertProjectAccess.mockReset();
    mocks.listAccessibleProjects.mockReset();
    mocks.assertOrgAccess.mockReset();
    mocks.listAccessibleOrgs.mockReset();
    mocks.fetchWhoami.mockReset();
    mocks.fetchProjectContext.mockReset();
    mocks.fetchListAnnotations.mockReset();
    mocks.fetchListPersonalAnnotations.mockReset();
    mocks.fetchListOrgAnnotations.mockReset();
    mocks.fetchAnnotation.mockReset();
    mocks.updateAnnotationStatus.mockReset();
    mocks.addAnnotationComment.mockReset();
    mocks.redisGet.mockResolvedValue(null);

    // Default: every authenticated request resolves to the stub user with
    // access to PROJECT_ID. Individual tests can override.
    mocks.verifyOAuthToken.mockResolvedValue(STUB_VERIFIED);
    mocks.assertProjectAccess.mockResolvedValue(true);
    mocks.assertOrgAccess.mockResolvedValue(true);
    mocks.listAccessibleOrgs.mockResolvedValue([]);
  });

  it("responds to MCP initialize with serverInfo.name === 'remarks'", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer eyJfake.jwt.value",
      },
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "vitest-mcp-init", version: "0.0.0" },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"serverInfo"');
    expect(response.body).toContain('"name":"remarks"');
  });

  it("rejects /mcp requests without a bearer token (challenge advertises PRM)", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      payload: {
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "x", version: "0" },
        },
      },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
    expect(response.headers["www-authenticate"]).toContain("resource_metadata=");
    expect(response.headers["www-authenticate"]).toContain("oauth-protected-resource");
  });

  it("tools/list returns all 12 Remarks tools with their names", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer eyJfake.jwt.value",
      },
      payload: {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/list",
      },
    });

    expect(response.statusCode).toBe(200);
    const envelope = parseJsonRpcResponse(response.body);
    const result = envelope.result as { tools: Array<{ name: string }> };
    const names = result.tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "remarks_whoami",
        "remarks_list_tasks",
        "remarks_get_task",
        "remarks_get_project_context",
        "remarks_update_task_status",
        "remarks_add_task_comment",
        "remarks_acknowledge",
        "remarks_dismiss",
        "remarks_get_pending",
        "remarks_get_all_pending",
        "remarks_batch_update_status",
        "remarks_open_pr",
        "remarks_watch_annotations",
      ])
    );
    expect(names).toHaveLength(13);
  });

  it("tools/call remarks_whoami routes through the handler", async () => {
    mocks.fetchWhoami.mockResolvedValueOnce({
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "alice@example.com",
        name: "Alice",
      },
      projects: [{ id: PROJECT_ID, name: "Acme", slug: "acme" }],
    });

    const response = await server.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer eyJfake.jwt.value",
      },
      payload: {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "remarks_whoami", arguments: {} },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.fetchWhoami).toHaveBeenCalledWith(CLERK_USER_ID);
    const envelope = parseJsonRpcResponse(response.body);
    const result = envelope.result as {
      structuredContent: {
        user: { name: string };
        projects: Array<{ name: string }>;
        oauth_client_name: string;
      };
      isError?: boolean;
    };
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.projects[0]?.name).toBe("Acme");
    expect(result.structuredContent.oauth_client_name).toBe("Claude Code");
  });

  it("tools/call remarks_update_task_status routes through the handler", async () => {
    mocks.updateAnnotationStatus.mockResolvedValueOnce({
      id: "33333333-3333-4333-8333-333333333333",
      status: "doing",
      updatedAt: "2026-04-26T10:00:00.000Z",
    });

    const response = await server.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer eyJfake.jwt.value",
      },
      payload: {
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: {
          name: "remarks_update_task_status",
          arguments: {
            task_id: "33333333-3333-4333-8333-333333333333",
            status: "doing",
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.updateAnnotationStatus).toHaveBeenCalledWith(
      "33333333-3333-4333-8333-333333333333",
      CLERK_USER_ID,
      "Claude Code",
      "doing",
      undefined,
      undefined
    );
    const envelope = parseJsonRpcResponse(response.body);
    const result = envelope.result as {
      structuredContent: { id: string; status: string; updated_at: string };
      isError?: boolean;
    };
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.status).toBe("doing");
  });

  it("tools/call remarks_open_pr returns the pending stub response", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer eyJfake.jwt.value",
      },
      payload: {
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: {
          name: "remarks_open_pr",
          arguments: {
            project_id: PROJECT_ID,
            task_ids: ["33333333-3333-4333-8333-333333333333"],
            branch: "feat/x",
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const envelope = parseJsonRpcResponse(response.body);
    const result = envelope.result as {
      structuredContent: { status: string; pr_url: string | null };
      isError?: boolean;
    };
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.status).toBe("pending_github_integration");
    expect(result.structuredContent.pr_url).toBeNull();
  });

  it("publishes Protected Resource Metadata at /.well-known/oauth-protected-resource/mcp", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/.well-known/oauth-protected-resource/mcp",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.resource).toBe("http://localhost:3000/mcp");
    expect(Array.isArray(body.authorization_servers)).toBe(true);
    // `openid` until Clerk ships custom OAuth scopes; see spec-gap A20.
    expect(body.scopes_supported).toEqual(["openid"]);
  });
});
