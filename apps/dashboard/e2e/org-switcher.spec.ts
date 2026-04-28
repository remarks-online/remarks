import { createClient, schema } from "@remarks/db";
import { ensureClerkOrg, ensureClerkOrgMembership } from "./clerk.js";
import {
  TEST_ORG_NAME,
  TEST_PROJECT_NAME,
  TEST_SECONDARY_ORG_NAME,
  TEST_SECONDARY_PROJECT_NAME,
  TEST_SECONDARY_PROJECT_SLUG,
} from "./constants.js";
import { expect, test } from "./fixtures.js";

// This spec verifies task 1.17: switching organizations via the Clerk
// <OrganizationSwitcher /> in the app header re-fetches the projects list for
// the newly-active org. It provisions a *second* Clerk org for the shared test
// user (per the README guideline: spec-specific seeding lives here, not in
// global-setup) so that the switcher actually has somewhere to switch to.

let secondaryClerkOrgId: string | undefined;

async function withDb<T>(fn: (client: ReturnType<typeof createClient>) => Promise<T>): Promise<T> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL missing for e2e seed");
  const client = createClient(databaseUrl);
  try {
    return await fn(client);
  } finally {
    await client.sql.end({ timeout: 5 });
  }
}

test.beforeAll(async () => {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const userId = process.env.E2E_CLERK_USER_ID;
  if (!secretKey || !userId) {
    throw new Error(
      "CLERK_SECRET_KEY and E2E_CLERK_USER_ID must be set (global-setup populates them)"
    );
  }

  const secondaryOrg = await ensureClerkOrg(secretKey, TEST_SECONDARY_ORG_NAME, userId);
  secondaryClerkOrgId = secondaryOrg.id;
  await ensureClerkOrgMembership(secretKey, secondaryOrg.id, userId, "org:admin");

  // Mirror what the Clerk webhook would sync: org row + a project the user is
  // an admin of. Idempotent so re-runs are harmless.
  await withDb(async ({ db }) => {
    const [org] = await db
      .insert(schema.organizations)
      .values({
        clerkOrgId: secondaryOrg.id,
        name: TEST_SECONDARY_ORG_NAME,
        slug: secondaryOrg.slug,
      })
      .onConflictDoUpdate({
        target: schema.organizations.clerkOrgId,
        set: {
          name: TEST_SECONDARY_ORG_NAME,
          slug: secondaryOrg.slug,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!org) throw new Error("secondary org upsert returned no row");

    const user = await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.clerkUserId, userId),
    });
    if (!user) throw new Error("global-setup did not seed the expected user row");

    await db
      .insert(schema.projects)
      .values({
        orgId: org.id,
        creatorUserId: user.id,
        name: TEST_SECONDARY_PROJECT_NAME,
        slug: TEST_SECONDARY_PROJECT_SLUG,
        primaryBranch: "main",
      })
      .onConflictDoNothing();

    const project = await db.query.projects.findFirst({
      where: (p, { and, eq }) => and(eq(p.orgId, org.id), eq(p.slug, TEST_SECONDARY_PROJECT_SLUG)),
    });
    if (!project) throw new Error("secondary project seed failed");

    await db
      .insert(schema.projectMembers)
      .values({ projectId: project.id, userId: user.id, role: "admin" })
      .onConflictDoNothing();
  });
});

test("switching organizations re-fetches the projects list", async ({ signedInPage: page }) => {
  // Fixture pinned us to the primary org. Confirm baseline. Use exact text
  // match because TEST_PROJECT_NAME is a prefix of TEST_SECONDARY_PROJECT_NAME.
  await page.goto("/app/projects");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByText(TEST_PROJECT_NAME, { exact: true })).toBeVisible();
  await expect(page.getByText(TEST_SECONDARY_PROJECT_NAME, { exact: true })).toBeHidden();

  // Open the switcher. Clerk's trigger is a button with accessible name
  // "Open organization switcher"; the active-org text is descendant content,
  // so filter by hasText rather than role-name.
  const trigger = page
    .getByRole("button")
    .filter({ hasText: new RegExp(TEST_ORG_NAME) })
    .first();
  await trigger.click();

  // Popover items render as `menuitem`s with the target org's name (plus
  // its logo alt-text) in their accessible name.
  const otherOrgOption = page.getByRole("menuitem", {
    name: new RegExp(TEST_SECONDARY_ORG_NAME),
  });
  await otherOrgOption.click();

  // afterSelectOrganizationUrl="/app/projects" sends us back to the list, and
  // the RSC re-runs with the new orgId from auth().
  await page.waitForURL(/\/app\/projects$/);
  await expect(page.getByText(TEST_SECONDARY_PROJECT_NAME, { exact: true })).toBeVisible();
  await expect(page.getByText(TEST_PROJECT_NAME, { exact: true })).toBeHidden();

  // Sanity: the trigger now advertises the secondary org as active.
  await expect(
    page
      .getByRole("button")
      .filter({ hasText: new RegExp(TEST_SECONDARY_ORG_NAME) })
      .first()
  ).toBeVisible();

  // Anchor for the seeded id; keeps the closure variable intentional.
  expect(secondaryClerkOrgId).toBeDefined();
});
