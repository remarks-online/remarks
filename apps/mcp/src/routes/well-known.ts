import type { FastifyInstance } from "fastify";
import { env } from "../env.js";

// RFC 9728 Protected Resource Metadata. MCP clients fetch this on receiving a
// 401 to discover the authorization server (Clerk) and the canonical resource
// URI to bind tokens to. ADR-0015. Public, no auth required.
//
// Clerk's authorization server URL is derived from the publishable key — the
// pattern is `https://<frontend-api-host>` for production tenants. Clients
// follow the AS metadata link from there to get token/authorize/register
// endpoints, all served by Clerk.
//
// scopes_supported: the MCP spec recommends advertising the minimum set
// needed for basic functionality; clients request all three by default.

function clerkIssuerFromPublishableKey(): string {
  // Clerk publishable keys encode the frontend API host. For Phase 2 we pull
  // it directly from CLERK_PUBLISHABLE_KEY by Base64-decoding the part after
  // `pk_test_` or `pk_live_`. If that ever changes, override via env.
  const segments = env.CLERK_PUBLISHABLE_KEY.split("_");
  const encoded = segments[segments.length - 1] ?? "";
  try {
    const host = Buffer.from(encoded, "base64").toString("utf-8").replace(/\$$/, "");
    return host.startsWith("http") ? host : `https://${host}`;
  } catch {
    return "https://clerk.com";
  }
}

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
        scopes_supported: ["tasks:read", "tasks:write", "project:read"],
        bearer_methods_supported: ["header"],
        resource_documentation: "https://docs.remarks.dev/mcp",
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
