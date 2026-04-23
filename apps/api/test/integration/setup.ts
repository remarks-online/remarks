// Env required by apps/api/src/env.ts; set before any src/* module loads.
// CLERK_* values are Clerk-safe placeholders — every test mocks @clerk/backend,
// so the real Clerk SDK is never reached.
process.env.CLERK_WEBHOOK_SECRET =
  process.env.CLERK_WEBHOOK_SECRET ?? "whsec_dW5pdC10ZXN0LXNlY3JldC1ub3QtZm9yLXByb2Q=";
process.env.CLERK_SECRET_KEY =
  process.env.CLERK_SECRET_KEY ?? "sk_test_dW5pdC10ZXN0LXNlY3JldC1ub3QtZm9yLXByb2Q=";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required for integration tests. In CI it's injected by the postgres service; " +
      "locally, point it at any Postgres 16 (e.g. your Neon dev branch).",
  );
}

// R2 env is required by envSchema; tests that don't exercise R2 still load
// src/env.ts transitively (via buildServer), so placeholders keep parsing
// happy. The r2 integration test reads process.env directly and fails fast
// when the real endpoint isn't set.
process.env.R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? "integration-test-account";
process.env.R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID ?? "integration-test-key";
process.env.R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY ?? "integration-test-secret";
process.env.R2_BUCKET_SCREENSHOTS =
  process.env.R2_BUCKET_SCREENSHOTS ?? "remarks-screenshots-test";
