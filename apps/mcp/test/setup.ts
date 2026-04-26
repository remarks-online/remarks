// Silence Fastify request logs in unit tests; integration runs (when added)
// can opt back into "info" via the env. NODE_ENV=test so any future code
// branches behave consistently across runners.
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "error";
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// Required by apps/mcp/src/env.ts (ADR-0015). Set deterministic placeholder
// values so the env schema parses; the JWT verifier itself is mocked at
// test boundaries so these values don't need to be valid Clerk credentials.
process.env.CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ?? "sk_test_dummy";
process.env.CLERK_PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY ?? "pk_test_dummy";
process.env.MCP_RESOURCE_URI = process.env.MCP_RESOURCE_URI ?? "http://localhost:3000/mcp";
process.env.INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN ?? "y".repeat(32);
process.env.API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
process.env.UPSTASH_REDIS_REST_URL =
  process.env.UPSTASH_REDIS_REST_URL ?? "https://test.upstash.io";
process.env.UPSTASH_REDIS_REST_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN ?? "test-redis-token";
