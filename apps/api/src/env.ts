import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  DATABASE_URL: z.string().url(),
  CLERK_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  CLERK_SECRET_KEY: z.string().startsWith("sk_"),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
