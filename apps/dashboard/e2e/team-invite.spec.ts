import type { Page } from "@playwright/test";
import { ensureClerkOrgMembership, ensureClerkUser, mintSignInToken } from "./clerk.js";
import { TEST_PROJECT_NAME, TEST_PROJECT_SLUG } from "./constants.js";
import { expect, test } from "./fixtures.js";

// Verifies task 1.33: an invited teammate (Clerk org member with no
// project_members row) signs into the dashboard and can list and open the
// org's projects. The auth-plugin backstop fans out an editor row on first
// authenticated request so /app/projects/:slug renders annotations rather
// than 404-ing. The Clerk-hosted invitation send/accept loop is exercised
// indirectly: ensureClerkOrgMembership simulates an accepted invite by
// creating the membership server-side via the Backend API.

const INVITEE_EMAIL = process.env.E2E_INVITEE_EMAIL ?? "remarks-invitee+clerk_test@example.com";
const INVITEE_PASSWORD = process.env.E2E_INVITEE_PASSWORD ?? "test-password-123!long";

let inviteeClerkUserId: string | undefined;

test.beforeAll(async () => {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const primaryOrgId = process.env.E2E_CLERK_ORG_ID;
  if (!secretKey?.startsWith("sk_test_")) {
    throw new Error("CLERK_SECRET_KEY must be a dev (sk_test_*) key for the invitee provisioning");
  }
  if (!primaryOrgId) {
    throw new Error("E2E_CLERK_ORG_ID missing — global-setup did not run");
  }

  const invitee = await ensureClerkUser(secretKey, INVITEE_EMAIL, {
    password: INVITEE_PASSWORD,
    firstName: "Invited",
    lastName: "Teammate",
  });
  inviteeClerkUserId = invitee.id;
  await ensureClerkOrgMembership(secretKey, primaryOrgId, invitee.id, "org:member");
});

async function signInAsInvitee(page: Page): Promise<void> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const primaryOrgId = process.env.E2E_CLERK_ORG_ID;
  if (!secretKey || !inviteeClerkUserId || !primaryOrgId) {
    throw new Error("invitee setup did not complete");
  }
  const token = await mintSignInToken(secretKey, inviteeClerkUserId);
  await page.goto(`/sign-in?__clerk_ticket=${encodeURIComponent(token)}`);
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 30_000 });
  // Pin to the shared primary org so /app/projects fetches projects from it.
  await page.goto("/app/projects");
  await page.waitForFunction(
    // @ts-expect-error - window.Clerk is injected by ClerkProvider
    () => typeof window.Clerk?.setActive === "function" && window.Clerk?.loaded,
    null,
    { timeout: 15_000 }
  );
  await page.evaluate(async (id) => {
    // @ts-expect-error - window.Clerk is injected by ClerkProvider
    await window.Clerk.setActive({ organization: id });
  }, primaryOrgId);
}

test("invited teammate sees the org's projects and can open one", async ({ page }) => {
  await signInAsInvitee(page);

  await page.goto("/app/projects");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByText(TEST_PROJECT_NAME, { exact: true })).toBeVisible();

  await page.getByRole("link", { name: new RegExp(TEST_PROJECT_NAME) }).click();
  await page.waitForURL(`/app/projects/${TEST_PROJECT_SLUG}`);
  // Detail page renders for an org member who had no project_members row at
  // sign-in — proves the auth-plugin backstop ran and minted the editor row.
  await expect(page.getByRole("heading", { name: TEST_PROJECT_NAME })).toBeVisible();
});
