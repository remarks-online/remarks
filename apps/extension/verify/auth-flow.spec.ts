import path from "node:path";
import { fileURLToPath } from "node:url";
import { type BrowserContext, chromium, expect, test } from "@playwright/test";
// Test user + org identity are shared with the dashboard's Playwright suite:
// one fixture user across both so global-setup's provisioning is a single
// source of truth.
import { TEST_ORG_NAME, TEST_USER_EMAIL, TEST_USER_PASSWORD } from "../../dashboard/e2e/constants";
import {
  ensureClerkOrg,
  ensureClerkOrgMembership,
  ensureClerkUser,
  mintSignInToken,
} from "./clerk-helpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.resolve(__dirname, "..", ".output", "chrome-mv3");
const USER_DATA_DIR = path.resolve(__dirname, ".user-data");

// The extension's key in wxt.config.ts pins the ID across all unpacked loads.
const EXT_ID = "baikikfefeheiildmfoaicbjbnbecgjd";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} missing — check that apps/api/.env.local and apps/extension/.env(.local) are populated`
    );
  }
  return value;
}

test("background createClerkClient produces a valid Bearer token for the sidebar", async () => {
  const secretKey = requireEnv("CLERK_SECRET_KEY");
  const syncHost = requireEnv("WXT_CLERK_SYNC_HOST");

  // 1. Provision user + org + membership (idempotent).
  const user = await ensureClerkUser(secretKey, TEST_USER_EMAIL, { password: TEST_USER_PASSWORD });
  const org = await ensureClerkOrg(secretKey, TEST_ORG_NAME, user.id);
  await ensureClerkOrgMembership(secretKey, org.id, user.id, "org:admin");

  // 2. Launch Chromium with the unpacked extension. Headed — MV3 service
  //    workers don't register reliably under Playwright's headless mode.
  const context: BrowserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
  });

  try {
    // 3. Grab the service worker and capture errors so SDK exceptions surface
    //    in the test output instead of hiding behind a generic timeout.
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15_000 });
    expect(sw.url()).toContain(EXT_ID);
    const swErrors: string[] = [];
    sw.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        console.log(`[sw error] ${text}`);
        swErrors.push(text);
      }
    });

    // 4. Redeem a Clerk sign-in ticket against syncHost. This sets the
    //    session cookie on the dashboard origin, which the extension's
    //    createClerkClient({ background: true, syncHost }) reads.
    const ticket = await mintSignInToken(secretKey, user.id);
    const redeemPage = await context.newPage();
    await redeemPage.goto(`${syncHost}/sign-in?__clerk_ticket=${encodeURIComponent(ticket)}`);
    await redeemPage.waitForURL((url) => !url.searchParams.has("__clerk_ticket"), {
      timeout: 30_000,
    });
    await redeemPage.close();

    // 5. Open the extension popup. <ActiveOrgSync /> in the popup writes the
    //    active org id to chrome.storage.local, which readAuthStatus() reads.
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${EXT_ID}/popup.html`);
    await popup.waitForLoadState("networkidle");
    await popup.waitForFunction(
      () =>
        new Promise<boolean>((resolve) => {
          chrome.storage.local.get("remarks.activeClerkOrgId", (result) => {
            resolve(Boolean(result["remarks.activeClerkOrgId"]));
          });
        }),
      null,
      { timeout: 30_000 }
    );

    // 6. Read auth status directly via sw.evaluate. Playwright 1.59 doesn't
    //    reliably dispatch chrome.runtime.sendMessage from a popup page to
    //    an MV3 service worker — the onMessage listener never fires even
    //    though the SW is alive. Invoking the exposed globalThis hook
    //    bypasses messaging entirely and exercises the architecture we
    //    actually care about: createClerkClient({ background: true }) +
    //    readAuthStatus().
    const response = (await sw.evaluate(async () => {
      const fn = (globalThis as unknown as { __remarksReadAuthStatus?: () => Promise<unknown> })
        .__remarksReadAuthStatus;
      if (typeof fn !== "function") return { error: "__remarksReadAuthStatus not exposed" };
      try {
        return await fn();
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    })) as {
      signedIn?: boolean;
      token?: string | null;
      clerkOrgId?: string | null;
      error?: string;
    };

    expect(response.error).toBeUndefined();
    expect(response.signedIn).toBe(true);
    expect(response.clerkOrgId).toBe(org.id);

    // 7. Token must be a well-formed Clerk JWT.
    expect(response.token).toBeTruthy();
    const token = response.token as string;
    const segments = token.split(".");
    expect(segments).toHaveLength(3);

    // Decode payload (no signature verification — the API handles that).
    // biome-ignore lint/style/noNonNullAssertion: split length asserted above.
    const payloadJson = Buffer.from(segments[1]!, "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as { sub?: string; exp?: number; iss?: string };
    expect(payload.sub).toBe(user.id);
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(payload.iss).toContain("clerk");

    // 8. No error-level messages should have reached the SW console.
    if (swErrors.length > 0) {
      throw new Error(`service worker logged errors:\n${swErrors.join("\n")}`);
    }
  } finally {
    await context.close();
  }
});
