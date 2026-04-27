import type { FastifyInstance } from "fastify";
import { env } from "../env.js";
import { clerkIssuerFromPublishableKey } from "../lib/clerk-issuer.js";

// RFC 9728 Protected Resource Metadata. MCP clients fetch this on receiving a
// 401 to discover the authorization server (Clerk) and the canonical resource
// URI to bind tokens to. ADR-0015. Public, no auth required.
//
// Clerk's authorization server URL is derived from the publishable key — the
// pattern is `https://<frontend-api-host>` for production tenants. Clients
// follow the AS metadata link from there to get token/authorize/register
// endpoints, all served by Clerk.
//
// scopes_supported is `openid` until Clerk ships custom OAuth scopes
// (roadmap as of 2026-04). The MCP server stubs `tasks:*` / `project:read`
// onto verified Clerk JWTs in lib/jwt.ts so per-tool requireScope checks
// keep working. Spec-gap A20 tracks unwinding the stub.

export async function wellKnownRoutes(fastify: FastifyInstance): Promise<void> {
  const issuer = clerkIssuerFromPublishableKey();

  fastify.get("/.well-known/oauth-protected-resource/mcp", async (_request, reply) => {
    return reply
      .header("access-control-allow-origin", "*")
      .header("access-control-allow-methods", "GET, OPTIONS")
      .header("access-control-allow-headers", "Authorization, Content-Type")
      .code(200)
      .send({
        resource: env.MCP_RESOURCE_URI,
        authorization_servers: [issuer],
        scopes_supported: ["openid"],
        bearer_methods_supported: ["header"],
        resource_documentation: "https://docs.remarks.online/mcp",
      });
  });

  fastify.options("/.well-known/oauth-protected-resource/mcp", async (_request, reply) => {
    return reply
      .header("access-control-allow-origin", "*")
      .header("access-control-allow-methods", "GET, OPTIONS")
      .header("access-control-allow-headers", "Authorization, Content-Type")
      .code(204)
      .send();
  });
}
