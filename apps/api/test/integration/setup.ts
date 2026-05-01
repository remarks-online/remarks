// Env required by apps/api/src/env.ts; set before any src/* module loads.
// CLERK_* values are Clerk-safe placeholders — every test mocks @clerk/backend,
// so the real Clerk SDK is never reached.
process.env.CLERK_WEBHOOK_SECRET =
  process.env.CLERK_WEBHOOK_SECRET ?? "whsec_dW5pdC10ZXN0LXNlY3JldC1ub3QtZm9yLXByb2Q=";
process.env.CLERK_SECRET_KEY =
  process.env.CLERK_SECRET_KEY ?? "sk_test_dW5pdC10ZXN0LXNlY3JldC1ub3QtZm9yLXByb2Q=";
// authorizedParties allowlist for verifyToken (auth plugin, A11). Integration
// tests mock @clerk/backend, so the real verifier never enforces this — the
// value just satisfies env-schema's strict parse on module load.
process.env.CLERK_AUTHORIZED_PARTIES =
  process.env.CLERK_AUTHORIZED_PARTIES ??
  "http://localhost:3000,chrome-extension://baikikfefeheiildmfoaicbjbnbecgjd";

// Default INTERNAL_API_TOKEN to a known throwaway value when the dev hasn't
// set one in .env.local yet. The internal-auth integration test (task 2.5)
// reads this same value via env.ts to construct its `x-internal-auth` header.
process.env.INTERNAL_API_TOKEN =
  process.env.INTERNAL_API_TOKEN ?? "integration-test-internal-api-token-32chars";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required for integration tests. In CI it's injected by the postgres service; " +
      "locally, point it at any Postgres 16 (e.g. your Neon dev branch)."
  );
}

// R2 env: when R2_S3_ENDPOINT points at localhost (i.e. MinIO via
// `pnpm minio:up` or the CI service container), force MinIO creds even if
// the dev has real R2 creds in their .env.local. That keeps runtime env
// (real R2) and test env (MinIO) from colliding and prevents accidental
// writes to a real bucket. When R2_S3_ENDPOINT is unset, fall back to
// placeholders so envSchema.parse doesn't fail for non-R2 tests.
const r2Endpoint = process.env.R2_S3_ENDPOINT ?? "";
const isLocalMinio = r2Endpoint.includes("localhost") || r2Endpoint.includes("127.0.0.1");
if (isLocalMinio) {
  process.env.R2_ACCOUNT_ID = "test";
  process.env.R2_ACCESS_KEY_ID = "minioadmin";
  process.env.R2_SECRET_ACCESS_KEY = "minioadmin";
  process.env.R2_BUCKET_SCREENSHOTS = "remarks-screenshots-test";
} else {
  process.env.R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? "test";
  process.env.R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID ?? "minioadmin";
  process.env.R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY ?? "minioadmin";
  process.env.R2_BUCKET_SCREENSHOTS =
    process.env.R2_BUCKET_SCREENSHOTS ?? "remarks-screenshots-test";
}

// Inngest env is required by envSchema; integration tests mock `inngest.send`
// (or rely on the mock from individual test files) so the SDK never reaches
// the network — placeholders satisfy parsing.
process.env.INNGEST_EVENT_KEY =
  process.env.INNGEST_EVENT_KEY ?? "integration-test-event-key";
process.env.INNGEST_SIGNING_KEY =
  process.env.INNGEST_SIGNING_KEY ?? "signkey-test-integration-key";
