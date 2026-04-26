import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance } from "fastify";

const SERVER_NAME = "remarks";
// Keep in sync with apps/mcp/package.json#version. Surfaced in the MCP
// initialize response's serverInfo.version (Phase 2 spec §3.1: server
// version, not per-tool versions; bump on breaking tool-surface changes).
const SERVER_VERSION = "0.0.0";

export async function mcpRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.route({
    method: ["POST", "GET", "DELETE"],
    url: "/mcp",
    handler: async (request, reply) => {
      // Detach Fastify's reply pipeline so the SDK transport can write
      // directly to the underlying Node response. Without this, Fastify
      // would try to send a default reply after handleRequest resolves.
      reply.hijack();

      // Stateless mode: fresh Server + Transport per HTTP request, no
      // session store. Task 2.4 plugs bearer-token auth in as a Fastify
      // preHandler above this route; tasks 2.6+ register tool handlers on
      // the Server via setRequestHandler before connect (Phase 2 spec §8.3).
      const server = new Server(
        { name: SERVER_NAME, version: SERVER_VERSION },
        { capabilities: { tools: {}, resources: {} } }
      );
      // Omitting sessionIdGenerator is the SDK's signal for stateless mode;
      // passing `undefined` explicitly trips exactOptionalPropertyTypes.
      const transport = new StreamableHTTPServerTransport();

      try {
        // @ts-expect-error — SDK Transport interface declares `onclose?: () => void`
        // (optional, not undefined-typed) while the StreamableHTTPServerTransport
        // class has `onclose: (() => void) | undefined`. Under
        // exactOptionalPropertyTypes the two are not assignable, but they're
        // runtime-equivalent. Remove this when the SDK aligns the two.
        await server.connect(transport);
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } catch (err) {
        request.log.error({ err }, "mcp transport failed to handle request");
        if (!reply.raw.headersSent) {
          reply.raw.statusCode = 500;
          reply.raw.setHeader("Content-Type", "application/json");
          reply.raw.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32603, message: "Internal error" },
              id: null,
            })
          );
        } else {
          reply.raw.end();
        }
      }
    },
  });
}
