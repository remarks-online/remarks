import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  // `::` binds dual-stack on Linux (both IPv4 + IPv6) so Fly's IPv6-only 6PN
  // network can reach the server at `<app>.internal:<port>`. Plain `0.0.0.0`
  // is IPv4-only — DNS resolves but TCP connect refuses over 6PN.
  HOST: z.string().default("::"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // Clerk credentials. Used to verify OAuth-issued JWTs and to resolve OAuth
  // app metadata (the human-readable client name surfaced on agent-authored
  // events). ADR-0015.
  CLERK_SECRET_KEY: z.string().startsWith("sk_"),
  CLERK_PUBLISHABLE_KEY: z.string().startsWith("pk_"),
  // Canonical resource URI advertised in PRM and validated against `aud` on
  // every token (RFC 8707). Local dev: http://localhost:4001/mcp;
  // production: https://mcp.remarks.online/mcp.
  MCP_RESOURCE_URI: z.string().url(),
  // Shared secret carried on every internal MCP→API call so the API can refuse
  // requests that arrive on `*.internal` from anywhere other than this server.
  INTERNAL_API_TOKEN: z.string().min(32),
  // Base URL of the Remarks API for service-to-service calls.
  API_INTERNAL_URL: z.string().url(),
  // Upstash REST endpoint + token. The MCP auth plugin caches per-user
  // membership lookups here for 5 min (ADR-0015).
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;
