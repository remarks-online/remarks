import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types/auth.js";

// Bypass the auth plugin's network calls: hand it a cached AuthContext on
// every redis.get so the request reaches the MCP route without needing a
// real Upstash or API. The plugin's own behavior is covered in
// apps/mcp/src/plugins/mcp-auth.test.ts.
const mocks = vi.hoisted(() => ({
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  resolveToken: vi.fn(),
  fetchWhoami: vi.fn(),
  fetchProjectContext: vi.fn(),
  fetchListAnnotations: vi.fn(),
  fetchAnnotation: vi.fn(),
}));

vi.mock("../lib/redis.js", () => ({
  redis: { get: mocks.redisGet, set: mocks.redisSet },
}));

vi.mock("../lib/api-client.js", () => ({
  resolveToken: mocks.resolveToken,
  fetchWhoami: mocks.fetchWhoami,
  fetchProjectContext: mocks.fetchProjectContext,
  fetchListAnnotations: mocks.fetchListAnnotations,
  fetchAnnotation: mocks.fetchAnnotation,
}));

const { buildServer } = await import("../server.js");

// Real-shape v4 UUIDs (Zod 4's uuid validator is stricter than v3 — version
// nibble must be 1-8, variant 8-b — so the test fixture mirrors the format
// of values actually issued by `gen_random_uuid()` in Postgres.)
const STUB_AUTH: AuthContext = {
  tokenId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  scopes: ["tasks:read", "tasks:write", "project:read"],
};

// Streamable HTTP either returns plain JSON or text/event-stream encoding the
// JSON-RPC envelope. Both paths put the result on the same logical message;
// this helper extracts it.
function parseJsonRpcResponse(body: string): { result?: unknown; error?: unknown } {
  // Plain JSON happy path.
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object" && ("result" in parsed || "error" in parsed)) {
      return parsed as { result?: unknown; error?: unknown };
    }
  } catch {
    // Fall through to SSE parsing.
  }
  // SSE path: lines like `data: {...}` for each event; the JSON-RPC envelope
  // is the last data line.
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
    mocks.redisGet.mockResolvedValue(STUB_AUTH);
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    mocks.fetchWhoami.mockReset();
    mocks.fetchProjectContext.mockReset();
    mocks.fetchListAnnotations.mockReset();
    mocks.fetchAnnotation.mockReset();
  });

  it("responds to MCP initialize with serverInfo.name === 'remarks'", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer rmk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
    // The transport may respond with text/event-stream or application/json
    // depending on Accept negotiation; both encode a JSON-RPC envelope that
    // contains the same serverInfo. Substring-check tolerates either.
    expect(response.body).toContain('"serverInfo"');
    expect(response.body).toContain('"name":"remarks"');
  });

  it("rejects /mcp requests without a bearer token", async () => {
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
  });

  it("tools/list returns all 8 Remarks tools with their names", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer rmk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
        "remarks_batch_update_status",
        "remarks_open_pr",
      ])
    );
    expect(names).toHaveLength(8);
  });

  it("tools/call remarks_whoami routes through the handler", async () => {
    mocks.fetchWhoami.mockResolvedValueOnce({
      token: { id: STUB_AUTH.tokenId, name: "Cursor on laptop", scopes: STUB_AUTH.scopes },
      project: { id: STUB_AUTH.projectId, name: "Acme", slug: "acme" },
    });

    const response = await server.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer rmk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      payload: {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "remarks_whoami", arguments: {} },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.fetchWhoami).toHaveBeenCalledWith(STUB_AUTH.tokenId);
    const envelope = parseJsonRpcResponse(response.body);
    const result = envelope.result as {
      structuredContent: { project: { name: string }; token_name: string };
      isError?: boolean;
    };
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.project.name).toBe("Acme");
    expect(result.structuredContent.token_name).toBe("Cursor on laptop");
  });

  it("tools/call for an unimplemented mutator returns an INTERNAL error envelope", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer rmk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
    const envelope = parseJsonRpcResponse(response.body);
    const result = envelope.result as {
      isError?: boolean;
      structuredContent: { error: { code: string } };
    };
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error.code).toBe("INTERNAL");
  });
});
