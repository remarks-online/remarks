import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Reuse the env files the rest of the app already uses instead of asking
// devs to maintain a third `.env.local` for this one-off suite. Resolve
// paths from __dirname so they're stable regardless of where Playwright is
// invoked from.
//   ../.env              → apps/extension/.env       (WXT_* defaults, committed)
//   ../.env.local        → apps/extension/.env.local (optional overrides)
//   ../../api/.env.local → apps/api/.env.local       (CLERK_SECRET_KEY lives here)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../.env") });
loadEnv({ path: path.resolve(__dirname, "../.env.local") });
loadEnv({ path: path.resolve(__dirname, "../../api/.env.local") });

export default defineConfig({
  testDir: ".",
  // MV3 extensions don't load in headless Chromium reliably; headed is
  // required. Keep timeouts generous because we drive the real Clerk API.
  timeout: 120_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  // Traces go to apps/extension/test-results/ on failure.
  use: { trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
