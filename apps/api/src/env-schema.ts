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
  // Comma-separated allowlist of `azp` (authorized party) origins that issued
  // session JWTs are accepted from. Passed to @clerk/backend `verifyToken`.
  // Mitigates Clerk's "subdomain cookie leaking attack" — a token minted for
  // some other application on a Clerk subdomain replayed against our API. See
  // https://clerk.com/docs/reference/backend/verify-token. Required in every
  // environment; must include the dashboard origin and the extension origin.
  CLERK_AUTHORIZED_PARTIES: z
    .string()
    .min(1)
    .transform((s) =>
      s
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
    )
    .pipe(z.array(z.string().min(1)).min(1)),
  // Shared secret carried on every internal MCP→API call (`x-internal-auth`
  // header). The MCP server reads the same value from its own env and the
  // /internal/* scope refuses requests that don't match. Phase 2 spec §5.4.
  INTERNAL_API_TOKEN: z.string().min(32),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_SCREENSHOTS: z.string().min(1),
  // Bucket holding signed extension build artifacts (zip + latest.json) used
  // by the alpha distribution flow at GET /v1/extension/latest. Separate from
  // screenshots so retention and access can diverge later (ADR-0017).
  R2_BUCKET_EXTENSION_BUILDS: z.string().min(1),
  // Optional override for S3-compatible endpoints used in tests (MinIO at
  // http://localhost:9000). When unset, r2.ts derives the real endpoint from
  // R2_ACCOUNT_ID.
  R2_S3_ENDPOINT: z.string().url().optional(),
  // PostHog server (posthog-node) project key. Optional — capture() no-ops
  // when unset so local dev / CI without analytics doesn't crash. Set in Fly
  // secrets for production.
  POSTHOG_PROJECT_API_KEY: z.string().optional(),
  POSTHOG_HOST: z.string().url().default("https://us.i.posthog.com"),
  // Inngest event API key — used by the Inngest SDK to authenticate events
  // sent from this app. Required: phase-2 task 2.30 (R2 cleanup) is the first
  // production use of Inngest, and we want startup to fail loudly if the
  // secret isn't wired. Find under Inngest dashboard → Manage → Event Keys.
  INNGEST_EVENT_KEY: z.string().min(1),
  // Inngest signing key — Inngest signs HTTP calls into our /inngest serve
  // handler with this; the SDK rejects unsigned requests. Required for the
  // same reason as INNGEST_EVENT_KEY. Same dashboard, "Signing Key" tab.
  INNGEST_SIGNING_KEY: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;
