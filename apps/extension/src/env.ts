import { z } from "zod";

const envSchema = z.object({
  WXT_CLERK_PUBLISHABLE_KEY: z.string().startsWith("pk_"),
  WXT_API_URL: z.string().url(),
  WXT_CLERK_SYNC_HOST: z.string().url(),
});

export const env = envSchema.parse({
  WXT_CLERK_PUBLISHABLE_KEY: import.meta.env.WXT_CLERK_PUBLISHABLE_KEY,
  WXT_API_URL: import.meta.env.WXT_API_URL,
  WXT_CLERK_SYNC_HOST: import.meta.env.WXT_CLERK_SYNC_HOST,
});

export type Env = z.infer<typeof envSchema>;
