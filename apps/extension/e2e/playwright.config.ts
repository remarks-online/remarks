import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Mirror verify/playwright.config.ts: pull env from the same files every other
// extension workflow uses. Resolve paths from __dirname so they're stable
// regardless of where Playwright is invoked from.
//   ../.env              → apps/extension/.env       (WXT_* defaults, committed)
//   ../.env.local        → apps/extension/.env.local (optional overrides)
//   ../../api/.env.local → apps/api/.env.local       (CLERK_SECRET_KEY, DATABASE_URL)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "..", ".env") });
loadEnv({ path: path.resolve(__dirname, "..", ".env.local") });
loadEnv({ path: path.resolve(__dirname, "..", "..", "api", ".env.local") });

export default defineConfig({
  testDir: ".",
  globalSetup: "./global-setup.ts",
  // MV3 service workers don't register reliably in headless Chromium and Clerk
  // ticket redemption goes through a real dev instance. Keep timeouts generous.
  timeout: 120_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // The Clerk ticket-redemption fixture navigates to ${WXT_DASHBOARD_URL}/sign-in,
  // and ProjectPicker calls the API at ${WXT_API_URL}. Both servers must be up.
  // cwd "../../.." lands at the repo root so pnpm filters resolve.
  webServer: [
    {
      command: "pnpm --filter @remarks/api dev",
      url: "http://localhost:4000/health",
      reuseExistingServer: true,
      // 180s, not 60s: cold CI runners need ~30s for `tsx watch` to import
      // the api graph and connect to Postgres, plus ~30-60s for `next dev` to
      // bundle the dashboard's first route. Locally the servers are usually
      // already up via reuseExistingServer.
      timeout: 180_000,
      cwd: "../../..",
    },
    {
      command: "pnpm --filter @remarks/dashboard dev",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      // 180s, not 60s: cold CI runners need ~30s for `tsx watch` to import
      // the api graph and connect to Postgres, plus ~30-60s for `next dev` to
      // bundle the dashboard's first route. Locally the servers are usually
      // already up via reuseExistingServer.
      timeout: 180_000,
      cwd: "../../..",
    },
  ],
});
