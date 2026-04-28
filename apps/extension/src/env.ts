import { z } from "zod";

const envSchema = z.object({
  WXT_CLERK_PUBLISHABLE_KEY: z.string().startsWith("pk_"),
  WXT_API_URL: z.string().url(),
  WXT_CLERK_SYNC_HOST: z.string().url(),
  WXT_DASHBOARD_URL: z.string().url(),
});

export type Env = z.infer<typeof envSchema>;

// Lazy validation. Previously this file parsed + threw at module load, which
// works everywhere except during `wxt prepare`: WXT executes entrypoint
// modules through vite-node to find `defineBackground`/`defineContentScript`
// metadata, and our committed `.env` defaults aren't present in CI (the file
// is gitignored). Eager throw there blocks `pnpm install`'s postinstall hook
// and CI before any real code runs.
//
// The Proxy keeps `env.WXT_*` usage unchanged across all call sites but
// defers the Zod parse until first property access — i.e., when the
// extension is actually running, not while WXT is scanning the module graph.
let cached: Env | undefined;
function resolve(): Env {
  if (cached) return cached;
  cached = envSchema.parse({
    WXT_CLERK_PUBLISHABLE_KEY: import.meta.env.WXT_CLERK_PUBLISHABLE_KEY,
    WXT_API_URL: import.meta.env.WXT_API_URL,
    WXT_CLERK_SYNC_HOST: import.meta.env.WXT_CLERK_SYNC_HOST,
    WXT_DASHBOARD_URL: import.meta.env.WXT_DASHBOARD_URL,
  });
  return cached;
}

export const env: Env = new Proxy({} as Env, {
  get: (_target, prop) => resolve()[prop as keyof Env],
});
