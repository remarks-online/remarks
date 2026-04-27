import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { env } from "../env.js";
import { verifyOAuthToken } from "../lib/jwt.js";
import type { AuthContext } from "../types/auth.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext;
  }
}

const BEARER_PREFIX = "Bearer ";
// `openid` until Clerk ships custom OAuth scopes (roadmap as of 2026-04).
// Per-tool authorization stays via requireScope() in tools/shared.ts; the
// stub in lib/jwt.ts grants `tasks:*` / `project:read` to verified Clerk
// JWTs so those checks keep working. Spec-gap A20 tracks unwinding.
const REQUIRED_SCOPES = "openid";

// MCP authorization spec: on missing/invalid token, return 401 with a
// WWW-Authenticate header pointing the client at our PRM document so it can
// discover the authorization server (Clerk) and run OAuth 2.1 + PKCE.
// ADR-0015.
function challengeHeader(): string {
  const prmUrl = `${new URL(env.MCP_RESOURCE_URI).origin}/.well-known/oauth-protected-resource/mcp`;
  return `Bearer resource_metadata="${prmUrl}", scope="${REQUIRED_SCOPES}"`;
}

const mcpAuthPlugin: FastifyPluginAsync = async (fastify) => {
  // Pre-declare the `auth` property so Fastify preserves V8's hidden class
  // across requests (mirrors apps/api/src/plugins/auth.ts).
  fastify.decorateRequest("auth", null as unknown as AuthContext);

  fastify.addHook("onRequest", async (request, reply) => {
    const header = request.headers.authorization;
    if (typeof header !== "string" || !header.startsWith(BEARER_PREFIX)) {
      reply.header("WWW-Authenticate", challengeHeader());
      return reply.code(401).send({
        error: {
          code: "UNAUTHORIZED",
          message: "Missing bearer token",
          requestId: request.id,
        },
      });
    }
    const jwt = header.slice(BEARER_PREFIX.length).trim();
    if (jwt.length === 0) {
      reply.header("WWW-Authenticate", challengeHeader());
      return reply.code(401).send({
        error: {
          code: "UNAUTHORIZED",
          message: "Missing bearer token",
          requestId: request.id,
        },
      });
    }

    try {
      const verified = await verifyOAuthToken(jwt);
      request.auth = {
        clerkUserId: verified.clerkUserId,
        scopes: verified.scopes,
        oauthClientName: verified.oauthClientName,
      };
    } catch (err) {
      request.log.warn({ err }, "JWT verification failed");
      reply.header("WWW-Authenticate", challengeHeader());
      return reply.code(401).send({
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid or expired token",
          requestId: request.id,
        },
      });
    }
    return undefined;
  });
};

// fastify-plugin so the onRequest hook propagates to the parent registration
// scope (server.ts wraps mcpRoutes in a child scope after this plugin).
export default fp(mcpAuthPlugin, { name: "mcp-auth" });
