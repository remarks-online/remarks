// Env required by apps/api/src/env.ts; set before any src/* module loads.
// Svix expects the secret suffix to be valid base64, so use a base64-encoded
// throwaway value rather than free-form text.
process.env.CLERK_WEBHOOK_SECRET =
  process.env.CLERK_WEBHOOK_SECRET ?? "whsec_dW5pdC10ZXN0LXNlY3JldC1ub3QtZm9yLXByb2Q=";
process.env.CLERK_SECRET_KEY =
  process.env.CLERK_SECRET_KEY ?? "sk_test_dW5pdC10ZXN0LXNlY3JldC1ub3QtZm9yLXByb2Q=";
// authorizedParties allowlist for verifyToken (auth plugin, A11). Tests mock
// @clerk/backend so the real verifier never runs, but env-schema validates at
// module load — placeholder origins satisfy the parse.
process.env.CLERK_AUTHORIZED_PARTIES =
  process.env.CLERK_AUTHORIZED_PARTIES ??
  "http://localhost:3000,chrome-extension://baikikfefeheiildmfoaicbjbnbecgjd";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://fake:fake@localhost:5432/fake";

// INTERNAL_API_TOKEN gates the /internal/* scope (task 2.5). Unit tests don't
// hit those routes but env-schema validates the var at module load, so a
// throwaway 32-char value satisfies parsing without leaking a real secret.
process.env.INTERNAL_API_TOKEN =
  process.env.INTERNAL_API_TOKEN ?? "unit-test-internal-api-token-not-prod-32";

// R2 env is required by envSchema; unit tests don't reach the S3 SDK, so
// placeholders satisfy parsing without any network effect.
process.env.R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? "unit-test-account";
process.env.R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID ?? "unit-test-key";
process.env.R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY ?? "unit-test-secret";
process.env.R2_BUCKET_SCREENSHOTS = process.env.R2_BUCKET_SCREENSHOTS ?? "remarks-screenshots-test";
process.env.R2_BUCKET_EXTENSION_BUILDS =
  process.env.R2_BUCKET_EXTENSION_BUILDS ?? "remarks-extension-builds-test";

// Inngest env is required by envSchema; tests mock `inngest.send` so the SDK
// never reaches the network — placeholders satisfy parsing.
process.env.INNGEST_EVENT_KEY = process.env.INNGEST_EVENT_KEY ?? "unit-test-event-key";
process.env.INNGEST_SIGNING_KEY = process.env.INNGEST_SIGNING_KEY ?? "signkey-test-unit-key";
