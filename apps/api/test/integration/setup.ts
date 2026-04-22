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
