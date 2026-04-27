import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  // `::` binds dual-stack on Linux (both IPv4 + IPv6) so Fly's IPv6-only 6PN
  // network can reach the server at `<app>.internal:<port>`. Plain `0.0.0.0`
  // is IPv4-only — DNS resolves but TCP connect refuses over 6PN.
  HOST: z.string().default("::"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  DATABASE_URL: z.string().url(),
  CLERK_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  CLERK_SECRET_KEY: z.string().startsWith("sk_"),
  // Shared secret carried on every internal MCP→API call (`x-internal-auth`
  // header). The MCP server reads the same value from its own env and the
  // /internal/* scope refuses requests that don't match. Phase 2 spec §5.4.
  INTERNAL_API_TOKEN: z.string().min(32),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_SCREENSHOTS: z.string().min(1),
  // Optional override for S3-compatible endpoints used in tests (MinIO at
  // http://localhost:9000). When unset, r2.ts derives the real endpoint from
  // R2_ACCOUNT_ID.
  R2_S3_ENDPOINT: z.string().url().optional(),
  // PostHog server (posthog-node) project key. Optional — capture() no-ops
  // when unset so local dev / CI without analytics doesn't crash. Set in Fly
  // secrets for production.
  POSTHOG_PROJECT_API_KEY: z.string().optional(),
  POSTHOG_HOST: z.string().url().default("https://us.i.posthog.com"),
});

export type Env = z.infer<typeof envSchema>;
