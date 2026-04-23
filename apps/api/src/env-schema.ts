import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  DATABASE_URL: z.string().url(),
  CLERK_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  CLERK_SECRET_KEY: z.string().startsWith("sk_"),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_SCREENSHOTS: z.string().min(1),
  // Optional override for S3-compatible endpoints used in tests (MinIO at
  // http://localhost:9000). When unset, r2.ts derives the real endpoint from
  // R2_ACCOUNT_ID.
  R2_S3_ENDPOINT: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;
