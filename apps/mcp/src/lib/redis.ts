import { Redis } from "@upstash/redis";
import { env } from "../env.js";

// Single Upstash REST client shared across requests. The MCP server is the
// first Redis consumer in the codebase (Phase 1's specced rate-limit Redis
// was never built); when a second consumer needs Redis, lift this into
// packages/shared.
export const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});
