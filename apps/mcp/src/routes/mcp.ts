import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import * as apiClient from "../lib/api-client.js";
import { createRedisIdempotencyCache } from "../lib/idempotency.js";
import { redis } from "../lib/redis.js";
import { registerToolHandlers } from "../tools/index.js";
import { SERVER_VERSION } from "../version.js";

const SERVER_NAME = "remarks";

// One cache instance per process (the Upstash REST client is stateless, so
// it's safe to share across requests). Built lazily at module load rather
// than per-request to avoid re-allocating on every MCP call.
const idempotencyCache = createRedisIdempotencyCache(redis);

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
      // session store. Bearer-token auth runs as a Fastify onRequest hook
      // above this route (apps/mcp/src/plugins/mcp-auth.ts); tool handlers
      // close over `request.auth` so each request operates strictly within
      // its token's project scope (Phase 2 spec §8.3 + §5.1).
      const server = new Server(
        { name: SERVER_NAME, version: SERVER_VERSION },
        { capabilities: { tools: {}, resources: {} } }
      );
      registerToolHandlers(server, {
        auth: request.auth,
        api: apiClient,
        idempotency: idempotencyCache,
        requestId: request.id,
      });
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
