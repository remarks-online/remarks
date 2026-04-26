import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // Shared secret used to hash bearer tokens before comparing against
  // project_api_tokens.token_hash. Must equal the salt the API uses during
  // token creation (task 2.20). Phase 2 spec §5.1.
  TOKEN_HASH_SALT: z.string().min(32),
  // Shared secret carried on every internal MCP→API call so the API can refuse
  // requests that arrive on `*.internal` from anywhere other than this server
  // (task 2.5 builds the matching API-side check). Phase 2 spec §5.4.
  INTERNAL_API_TOKEN: z.string().min(32),
  // Base URL of the Remarks API for service-to-service calls. On Fly this is
  // `http://remarks-api.internal:3000` (private VPC); locally it points at the
  // dev API on 4000.
  API_INTERNAL_URL: z.string().url(),
  // Upstash REST endpoint + token. The MCP auth plugin caches token-resolution
  // results here for 5 min (Phase 2 spec §5.4).
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
