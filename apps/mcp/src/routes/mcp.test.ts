import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types/auth.js";

// Bypass the auth plugin's network calls: hand it a cached AuthContext on
// every redis.get so the request reaches the MCP route without needing a
// real Upstash or API. The plugin's own behavior is covered in
// apps/mcp/src/plugins/mcp-auth.test.ts.
const mocks = vi.hoisted(() => ({
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  resolveToken: vi.fn(),
}));

vi.mock("../lib/redis.js", () => ({
  redis: { get: mocks.redisGet, set: mocks.redisSet },
}));

vi.mock("../lib/api-client.js", () => ({
  resolveToken: mocks.resolveToken,
}));

const { buildServer } = await import("../server.js");

const STUB_AUTH: AuthContext = {
  tokenId: "00000000-0000-0000-0000-000000000001",
  projectId: "00000000-0000-0000-0000-000000000002",
  scopes: ["tasks:read", "tasks:write", "project:read"],
};

describe("POST /mcp", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    mocks.redisGet.mockResolvedValue(STUB_AUTH);
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
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
});
