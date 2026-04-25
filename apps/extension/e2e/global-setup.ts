import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dashboardGlobalSetup from "../../dashboard/e2e/global-setup";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_OUTPUT = path.resolve(__dirname, "..", ".output", "chrome-mv3");

// Reuse the dashboard's globalSetup verbatim — it already provisions the exact
// fixture user/org/project this suite needs (TEST_USER_EMAIL, TEST_ORG_NAME,
// TEST_PROJECT_NAME) and emits E2E_CLERK_USER_ID / E2E_CLERK_ORG_ID for fixtures
// to consume. Building a parallel one duplicates seed code and risks drift.
//
// On top of that, fail fast if the extension hasn't been built — otherwise
// chromium.launchPersistentContext silently mounts no extension and specs time
// out waiting for a service worker that never registers.
export default async function globalSetup(): Promise<void> {
  if (!fs.existsSync(path.join(EXT_OUTPUT, "manifest.json"))) {
    throw new Error(
      `Extension build missing — expected ${EXT_OUTPUT}/manifest.json. Run \`pnpm --filter @remarks/extension build\` first, or use the test:e2e script which builds before invoking Playwright.`
    );
  }

  await dashboardGlobalSetup();
}
