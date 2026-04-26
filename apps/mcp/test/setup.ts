// Silence Fastify request logs in unit tests; integration runs (when added)
// can opt back into "info" via the env. NODE_ENV=test so any future code
// branches behave consistently across runners.
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "error";
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
