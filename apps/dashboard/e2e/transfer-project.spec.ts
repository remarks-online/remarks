import { type DB, createClient, schema } from "@remarks/db";
import { TEST_ORG_NAME } from "./constants.js";
import { expect, test } from "./fixtures.js";

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

async function deleteProjectByCreatorAndSlug(
  db: DB,
  sql: ReturnType<typeof createClient>["sql"],
  creatorUserId: string,
  slug: string
): Promise<void> {
  // Catches the project regardless of whether it's still personal or has been
  // moved into the org by a prior test run — the (creator, slug) pair is unique
  // enough for our test fixtures.
  const existing = await db.query.projects.findFirst({
    where: (p, { and, eq }) => and(eq(p.creatorUserId, creatorUserId), eq(p.slug, slug)),
    columns: { id: true },
  });
  if (!existing) return;
  await sql`DELETE FROM projects WHERE id = ${existing.id}`;
}

test.describe("project settings — move to organization", () => {
  const PROJECT_NAME = "1.x Move-to-org Settings";
  const PROJECT_SLUG = "e2e-1-x-move-to-org";
  let userDbId = "";
  let orgDbId = "";

  test.beforeEach(async () => {
    await withDb(async ({ db, sql }) => {
      const clerkUserId = process.env.E2E_CLERK_USER_ID;
      const clerkOrgId = process.env.E2E_CLERK_ORG_ID;
      if (!clerkUserId || !clerkOrgId) {
        throw new Error("E2E_CLERK_USER_ID / E2E_CLERK_ORG_ID must be set by global-setup");
      }
      const user = await db.query.users.findFirst({
        where: (u, { eq }) => eq(u.clerkUserId, clerkUserId),
      });
      const org = await db.query.organizations.findFirst({
        where: (o, { eq }) => eq(o.clerkOrgId, clerkOrgId),
      });
      if (!user || !org) throw new Error("global-setup did not seed the expected user/org");
      userDbId = user.id;
      orgDbId = org.id;

      // Idempotent: clean any leftover from a prior failed run, then seed fresh.
      await deleteProjectByCreatorAndSlug(db, sql, user.id, PROJECT_SLUG);

      const [project] = await db
        .insert(schema.projects)
        .values({
          orgId: null,
          creatorUserId: user.id,
          name: PROJECT_NAME,
          slug: PROJECT_SLUG,
          primaryBranch: "main",
        })
        .returning();
      if (!project) throw new Error("personal project insert returned no rows");

      await db.insert(schema.projectMembers).values({
        projectId: project.id,
        userId: user.id,
        role: "admin",
      });
    });
  });

  test.afterEach(async () => {
    await withDb(async ({ db, sql }) => {
      if (!userDbId) return;
      await deleteProjectByCreatorAndSlug(db, sql, userDbId, PROJECT_SLUG);
    });
  });

  test("creator picks org, project moves and Personal badge disappears", async ({
    signedInPage,
  }) => {
    await signedInPage.goto(`/app/projects/${PROJECT_SLUG}/settings`);
    await expect(signedInPage.getByRole("heading", { name: "Project settings" })).toBeVisible();
    // CardTitle renders as a <div>, not a heading — match by text instead.
    await expect(signedInPage.getByText("Move to organization", { exact: true })).toBeVisible();

    // The Select uses Radix internals — click the trigger then pick the option.
    // The test user belongs to a secondary org too (org-switcher.spec.ts), so
    // pick the primary by exact name rather than `.first()`.
    await signedInPage.getByLabel("Target organization").click();
    await signedInPage.getByRole("option", { name: TEST_ORG_NAME, exact: true }).click();

    await signedInPage.getByRole("button", { name: "Move project" }).click();

    // The mutation invalidates caches and `replace()`s back to settings; the
    // page re-renders without the move card (project is no longer personal).
    await expect(signedInPage.getByText("Move to organization", { exact: true })).toBeHidden({
      timeout: 10_000,
    });

    // Detail page no longer shows the Personal badge — the badge is a span
    // in the project header; "Personal" elsewhere (nav link) doesn't count.
    await signedInPage.goto(`/app/projects/${PROJECT_SLUG}`);
    await expect(signedInPage.locator("span", { hasText: /^Personal$/ })).toHaveCount(0);

    // DB confirms the move.
    await withDb(async ({ db }) => {
      const row = await db.query.projects.findFirst({
        where: (p, { and, eq }) => and(eq(p.creatorUserId, userDbId), eq(p.slug, PROJECT_SLUG)),
        columns: { orgId: true },
      });
      expect(row?.orgId).toBe(orgDbId);
    });
  });
});
