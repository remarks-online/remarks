// Env required by apps/api/src/env.ts; set before any src/* module loads.
// Svix expects the secret suffix to be valid base64, so use a base64-encoded
// throwaway value rather than free-form text.
process.env.CLERK_WEBHOOK_SECRET =
  process.env.CLERK_WEBHOOK_SECRET ?? "whsec_dW5pdC10ZXN0LXNlY3JldC1ub3QtZm9yLXByb2Q=";
process.env.CLERK_SECRET_KEY =
  process.env.CLERK_SECRET_KEY ?? "sk_test_dW5pdC10ZXN0LXNlY3JldC1ub3QtZm9yLXByb2Q=";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://fake:fake@localhost:5432/fake";

// R2 env is required by envSchema; unit tests don't reach the S3 SDK, so
// placeholders satisfy parsing without any network effect.
process.env.R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? "unit-test-account";
process.env.R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID ?? "unit-test-key";
process.env.R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY ?? "unit-test-secret";
process.env.R2_BUCKET_SCREENSHOTS = process.env.R2_BUCKET_SCREENSHOTS ?? "remarks-screenshots-test";
