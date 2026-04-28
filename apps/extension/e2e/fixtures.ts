import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type BrowserContext,
  type TestInfo,
  type Worker,
  test as base,
  chromium,
} from "@playwright/test";
import { mintSignInToken } from "../../dashboard/e2e/clerk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.resolve(__dirname, "..", ".output", "chrome-mv3");

// The extension's CRX_PUBLIC_KEY in wxt.config.ts pins this id across every
// "Load unpacked" install — both the verify suite and these specs depend on it.
export const EXT_ID = "baikikfefeheiildmfoaicbjbnbecgjd";

export interface ExtensionContext {
  context: BrowserContext;
  serviceWorker: Worker;
}

interface Fixtures {
  extensionContext: ExtensionContext;
  signedInExtensionContext: ExtensionContext;
}

function userDataDir(testInfo: TestInfo): string {
  // Per-test temp dir keeps each test's chrome.storage / cookies isolated and
  // lets retries start clean. Lives under test-results/ so the existing
  // gitignore (`test-results/`) covers it.
  const dir = path.resolve(
    __dirname,
    "..",
    "test-results",
    "e2e-user-data",
    `${testInfo.workerIndex}-${testInfo.testId}`
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function launchExtension(testInfo: TestInfo): Promise<ExtensionContext> {
  // MV3 service workers don't register reliably in headless Chromium — same
  // constraint the verify/ suite documented. CI wraps the runner with xvfb-run
  // so headed: false would still need to run under xvfb for windowing, which
  // doesn't help; keep it headed.
  const context = await chromium.launchPersistentContext(userDataDir(testInfo), {
    headless: false,
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
  });
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  }
  return { context, serviceWorker };
}

function requireEnv(name: string, hint: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} missing — ${hint}`);
  return value;
}

// Playwright requires the first arg to be an object-destructuring pattern even
// when no dependent fixtures are needed — playwright-core inspects the AST and
// throws "First argument must use the object destructuring pattern: …" if it
// sees anything else. Empty `{}` is the canonical shape; suppress per-fixture.
export const test = base.extend<Fixtures>({
  extensionContext: async (
    // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature
    {},
    use,
    testInfo
  ) => {
    const ext = await launchExtension(testInfo);
    try {
      await use(ext);
    } finally {
      await ext.context.close();
    }
  },
  signedInExtensionContext: async (
    // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture signature
    {},
    use,
    testInfo
  ) => {
    const secretKey = requireEnv(
      "CLERK_SECRET_KEY",
      "load apps/api/.env.local in playwright.config.ts"
    );
    const userId = requireEnv("E2E_CLERK_USER_ID", "global-setup did not run");
    const orgId = requireEnv("E2E_CLERK_ORG_ID", "global-setup did not run");
    const dashboardUrl = requireEnv(
      "WXT_DASHBOARD_URL",
      "load apps/extension/.env in playwright.config.ts"
    );

    const ext = await launchExtension(testInfo);
    try {
      // Mint a fresh ticket per test — single-use, short-lived. Redeem it on
      // the dashboard's /sign-in route. Once Clerk redirects off the sign-in
      // page, the session cookie is set on the dashboard origin and the SW's
      // createClerkClient picks it up via the syncHost cookie bridge.
      const ticket = await mintSignInToken(secretKey, userId);
      const redeemPage = await ext.context.newPage();
      await redeemPage.goto(`${dashboardUrl}/sign-in?__clerk_ticket=${encodeURIComponent(ticket)}`);
      await redeemPage.waitForURL((url) => !url.searchParams.has("__clerk_ticket"), {
        timeout: 30_000,
      });

      // Pin the active org so popup tests start from a known org. Mirrors the
      // dashboard fixture's pinActiveOrg (apps/dashboard/e2e/fixtures.ts:15-27)
      // — once the test user belongs to a second org, Clerk's org pick at
      // sign-in becomes non-deterministic. Navigating to an auth-protected
      // route forces ClerkProvider to fully hydrate a session before
      // setActive runs (otherwise it throws "setActive should either be
      // called with a session param or there should be already an active
      // session").
      await redeemPage.goto(`${dashboardUrl}/app/projects`);
      await redeemPage.waitForFunction(
        // @ts-expect-error - window.Clerk injected by the dashboard's ClerkProvider
        () => typeof window.Clerk?.setActive === "function" && window.Clerk?.loaded,
        null,
        { timeout: 15_000 }
      );
      await redeemPage.evaluate(async (id) => {
        // @ts-expect-error - window.Clerk injected by the dashboard's ClerkProvider
        await window.Clerk.setActive({ organization: id });
      }, orgId);
      await redeemPage.close();

      await use(ext);
    } finally {
      await ext.context.close();
    }
  },
});

export { expect } from "@playwright/test";
