// Silence Fastify request logs in unit tests; integration runs (when added)
// can opt back into "info" via the env. NODE_ENV=test so any future code
// branches behave consistently across runners.
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "error";
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

// Required by apps/mcp/src/env.ts. Set deterministic placeholder values so
// the env schema parses; tests that need real-shaped values for assertions
// (e.g. computing an expected token hash) read these same constants.
process.env.TOKEN_HASH_SALT = process.env.TOKEN_HASH_SALT ?? "x".repeat(32);
process.env.INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN ?? "y".repeat(32);
process.env.API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
process.env.UPSTASH_REDIS_REST_URL =
  process.env.UPSTASH_REDIS_REST_URL ?? "https://test.upstash.io";
process.env.UPSTASH_REDIS_REST_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN ?? "test-redis-token";
