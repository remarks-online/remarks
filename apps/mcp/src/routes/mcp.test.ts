import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";

describe("POST /mcp", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
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
});
