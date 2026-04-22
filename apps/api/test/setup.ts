// Env required by apps/api/src/env.ts; set before any src/* module loads.
// Svix expects the secret suffix to be valid base64, so use a base64-encoded
// throwaway value rather than free-form text.
process.env.CLERK_WEBHOOK_SECRET =
  process.env.CLERK_WEBHOOK_SECRET ?? "whsec_dW5pdC10ZXN0LXNlY3JldC1ub3QtZm9yLXByb2Q=";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://fake:fake@localhost:5432/fake";
