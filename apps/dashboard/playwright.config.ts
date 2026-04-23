import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Playwright doesn't read .env.local automatically the way Next.js does.
// Load from both apps/dashboard/.env.local (Clerk public + secret key) and
// apps/api/.env.local (DATABASE_URL for global-setup's DB seeding).
loadEnv({ path: ".env.local" });
loadEnv({ path: "../api/.env.local" });

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @remarks/api dev",
      url: "http://localhost:4000/health",
      reuseExistingServer: true,
      timeout: 60_000,
      cwd: "../..",
    },
    {
      command: "pnpm --filter @remarks/dashboard dev",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 60_000,
      cwd: "../..",
    },
  ],
});
