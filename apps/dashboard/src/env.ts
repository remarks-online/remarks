import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CLERK_SECRET_KEY: z.string().startsWith("sk_"),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().startsWith("pk_"),
  NEXT_PUBLIC_API_BASE_URL: z.string().url(),
  // PostHog browser SDK key. Optional in dev; analytics no-ops when unset so
  // local dev / preview deploys without a configured project don't crash. Set
  // to the `remarks` project's project key in Vercel Production.
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().url().default("https://us.i.posthog.com"),
  // Extension ID the dashboard uses to ping the installed extension via
  // chrome.runtime.sendMessage (see externally_connectable in
  // apps/extension/wxt.config.ts). Default is the load-unpacked dev ID
  // pinned by the committed manifest key (spec-gaps A8). Override in Vercel
  // Production once the Web Store assigns a different ID.
  NEXT_PUBLIC_EXTENSION_ID: z.string().default("baikikfefeheiildmfoaicbjbnbecgjd"),
  // Chrome Web Store listing URL surfaced as the primary "Add to Chrome" CTA
  // in the onboarding wizard. Optional — wizard falls back to load-unpacked
  // instructions when unset (Phase 1 default until §15 submission lands).
  NEXT_PUBLIC_CHROME_WEB_STORE_URL: z.string().url().optional(),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
