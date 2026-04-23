import { type Page, test as base } from "@playwright/test";
import { mintSignInToken } from "./clerk.js";

interface Fixtures {
  // A Page that has already redeemed a Clerk sign-in ticket for the default
  // test user (provisioned in global-setup). Specs just navigate and assert.
  signedInPage: Page;
}

// Pin the active org to the primary one provisioned by global-setup. Once the
// test user belongs to more than one Clerk org, the active org Clerk picks at
// sign-in is non-deterministic — this keeps every spec starting in a known
// state. Specs that exercise org switching (e.g. org-switcher.spec.ts) drive
// the change themselves from this baseline.
async function pinActiveOrg(page: Page, orgId: string): Promise<void> {
  await page.goto("/app/projects");
  await page.waitForFunction(
    // @ts-expect-error - window.Clerk is injected by ClerkProvider on the client
    () => typeof window.Clerk?.setActive === "function" && window.Clerk?.loaded,
    null,
    { timeout: 15_000 }
  );
  await page.evaluate(async (id) => {
    // @ts-expect-error - window.Clerk is injected by ClerkProvider on the client
    await window.Clerk.setActive({ organization: id });
  }, orgId);
}

export const test = base.extend<Fixtures>({
  signedInPage: async ({ page }, use) => {
    const secretKey = process.env.CLERK_SECRET_KEY;
    const userId = process.env.E2E_CLERK_USER_ID;
    const primaryOrgId = process.env.E2E_CLERK_ORG_ID;
    if (!secretKey)
      throw new Error("CLERK_SECRET_KEY missing — dotenv failed in playwright.config");
    if (!userId) throw new Error("E2E_CLERK_USER_ID missing — global-setup did not run");
    if (!primaryOrgId) throw new Error("E2E_CLERK_ORG_ID missing — global-setup did not run");

    const token = await mintSignInToken(secretKey, userId);
    await page.goto(`/sign-in?__clerk_ticket=${encodeURIComponent(token)}`);
    // Clerk redeems the ticket then redirects off /sign-in. Wait for that
    // before handing the page to the test so middleware sees the cookies on
    // the very next navigation.
    await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 });

    await pinActiveOrg(page, primaryOrgId);

    await use(page);
  },
});

export { expect } from "@playwright/test";
