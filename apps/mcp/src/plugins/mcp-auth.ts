import { UnauthorizedError } from "@remarks/shared";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { env } from "../env.js";
import { resolveToken } from "../lib/api-client.js";
import { hashApiToken } from "../lib/hash.js";
import { redis } from "../lib/redis.js";
import type { AuthContext } from "../types/auth.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext;
  }
}

const BEARER_PREFIX = "Bearer ";
const CACHE_KEY_PREFIX = "cache:mcp:auth:";
const CACHE_TTL_SECONDS = 300;

const mcpAuthPlugin: FastifyPluginAsync = async (fastify) => {
  // Pre-declare the `auth` property so Fastify preserves V8's hidden class
  // across requests (mirrors apps/api/src/plugins/auth.ts).
  fastify.decorateRequest("auth", null as unknown as AuthContext);

  fastify.addHook("onRequest", async (request) => {
    const header = request.headers.authorization;
    if (typeof header !== "string" || !header.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedError("Missing bearer token");
    }
    const plaintext = header.slice(BEARER_PREFIX.length).trim();
    if (plaintext.length === 0) {
      throw new UnauthorizedError("Missing bearer token");
    }

    const tokenHash = hashApiToken(plaintext, env.TOKEN_HASH_SALT);
    const cacheKey = `${CACHE_KEY_PREFIX}${tokenHash}`;

    const cached = await redis.get<AuthContext>(cacheKey);
    if (cached) {
      request.auth = cached;
      return;
    }

    const resolved = await resolveToken(tokenHash);
    if (!resolved) {
      throw new UnauthorizedError("Invalid or revoked token");
    }

    await redis.set(cacheKey, resolved, { ex: CACHE_TTL_SECONDS });
    request.auth = resolved;
  });
};

// fastify-plugin so the onRequest hook propagates to the parent registration
// scope (server.ts wraps mcpRoutes in a child scope after this plugin).
export default fp(mcpAuthPlugin, { name: "mcp-auth" });
