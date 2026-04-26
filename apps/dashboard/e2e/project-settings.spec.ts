import { type DB, createClient, schema } from "@remarks/db";
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

async function deleteProjectBySlug(
  db: DB,
  sql: ReturnType<typeof createClient>["sql"],
  orgId: string,
  slug: string
): Promise<void> {
  const existing = await db.query.projects.findFirst({
    where: (p, { and, eq }) => and(eq(p.orgId, orgId), eq(p.slug, slug)),
    columns: { id: true },
  });
  if (!existing) return;
  await sql`DELETE FROM projects WHERE id = ${existing.id}`;
}

test.describe("project settings — rename", () => {
  const ORIGINAL_NAME = "1.32 Rename Settings";
  const ORIGINAL_SLUG = "e2e-1-32-rename";
  const RENAMED_NAME = "1.32 Rename Settings (renamed)";
  const RENAMED_SLUG = "e2e-1-32-rename-renamed";

  test.beforeAll(async () => {
    await withDb(async ({ db, sql }) => {
      const clerkOrgId = process.env.E2E_CLERK_ORG_ID;
      const clerkUserId = process.env.E2E_CLERK_USER_ID;
      if (!clerkOrgId || !clerkUserId) {
        throw new Error("E2E_CLERK_ORG_ID and E2E_CLERK_USER_ID must be set by global-setup");
      }
      const org = await db.query.organizations.findFirst({
        where: (o, { eq }) => eq(o.clerkOrgId, clerkOrgId),
      });
      const user = await db.query.users.findFirst({
        where: (u, { eq }) => eq(u.clerkUserId, clerkUserId),
      });
      if (!org || !user) throw new Error("global-setup did not seed the expected org/user");

      // Cleanup either the original or renamed slug from a previous failed run.
      await deleteProjectBySlug(db, sql, org.id, ORIGINAL_SLUG);
      await deleteProjectBySlug(db, sql, org.id, RENAMED_SLUG);

      const [project] = await db
        .insert(schema.projects)
        .values({
          orgId: org.id,
          name: ORIGINAL_NAME,
          slug: ORIGINAL_SLUG,
          primaryBranch: "main",
        })
        .returning();
      if (!project) throw new Error("project insert returned no rows");

      await db.insert(schema.projectMembers).values({
        projectId: project.id,
        userId: user.id,
        role: "admin",
      });
    });
  });

  test.afterAll(async () => {
    await withDb(async ({ db, sql }) => {
      const clerkOrgId = process.env.E2E_CLERK_ORG_ID;
      if (!clerkOrgId) return;
      const org = await db.query.organizations.findFirst({
        where: (o, { eq }) => eq(o.clerkOrgId, clerkOrgId),
      });
      if (!org) return;
      await deleteProjectBySlug(db, sql, org.id, ORIGINAL_SLUG);
      await deleteProjectBySlug(db, sql, org.id, RENAMED_SLUG);
    });
  });

  test("rename name + slug redirects to new URL and shows the updated name on detail page", async ({
    signedInPage,
  }) => {
    await signedInPage.goto(`/app/projects/${ORIGINAL_SLUG}/settings`);
    await expect(signedInPage.getByRole("heading", { name: "Project settings" })).toBeVisible();

    await signedInPage.getByLabel("Name", { exact: true }).fill(RENAMED_NAME);
    await signedInPage.getByLabel("Slug", { exact: true }).fill(RENAMED_SLUG);
    await signedInPage.getByRole("button", { name: "Save changes" }).click();

    // After slug change, the page replaces the URL.
    await signedInPage.waitForURL(`/app/projects/${RENAMED_SLUG}/settings`);

    // Detail page should reflect the new name.
    await signedInPage.goto(`/app/projects/${RENAMED_SLUG}`);
    await expect(signedInPage.getByRole("heading", { name: RENAMED_NAME })).toBeVisible();

    // Old slug 404s.
    const oldRes = await signedInPage.goto(`/app/projects/${ORIGINAL_SLUG}`);
    expect(oldRes?.status()).toBe(404);
  });
});

test.describe("project settings — delete", () => {
  const PROJECT_NAME = "1.32 Delete Settings";
  const PROJECT_SLUG = "e2e-1-32-delete";

  test.beforeAll(async () => {
    await withDb(async ({ db, sql }) => {
      const clerkOrgId = process.env.E2E_CLERK_ORG_ID;
      const clerkUserId = process.env.E2E_CLERK_USER_ID;
      if (!clerkOrgId || !clerkUserId) {
        throw new Error("E2E_CLERK_ORG_ID and E2E_CLERK_USER_ID must be set by global-setup");
      }
      const org = await db.query.organizations.findFirst({
        where: (o, { eq }) => eq(o.clerkOrgId, clerkOrgId),
      });
      const user = await db.query.users.findFirst({
        where: (u, { eq }) => eq(u.clerkUserId, clerkUserId),
      });
      if (!org || !user) throw new Error("global-setup did not seed the expected org/user");

      await deleteProjectBySlug(db, sql, org.id, PROJECT_SLUG);

      const [project] = await db
        .insert(schema.projects)
        .values({
          orgId: org.id,
          name: PROJECT_NAME,
          slug: PROJECT_SLUG,
          primaryBranch: "main",
        })
        .returning();
      if (!project) throw new Error("project insert returned no rows");

      await db.insert(schema.projectMembers).values({
        projectId: project.id,
        userId: user.id,
        role: "admin",
      });
    });
  });

  test.afterAll(async () => {
    await withDb(async ({ db, sql }) => {
      const clerkOrgId = process.env.E2E_CLERK_ORG_ID;
      if (!clerkOrgId) return;
      const org = await db.query.organizations.findFirst({
        where: (o, { eq }) => eq(o.clerkOrgId, clerkOrgId),
      });
      if (!org) return;
      await deleteProjectBySlug(db, sql, org.id, PROJECT_SLUG);
    });
  });

  test("delete button gated by typing the slug; on click, redirects to project list and project is gone", async ({
    signedInPage,
  }) => {
    await signedInPage.goto(`/app/projects/${PROJECT_SLUG}/settings`);

    const deleteButton = signedInPage.getByRole("button", { name: "Delete project" });
    await expect(deleteButton).toBeDisabled();

    // Wrong slug keeps it disabled.
    const slugInput = signedInPage.getByLabel(`Type ${PROJECT_SLUG} to confirm`);
    await slugInput.fill("not-the-slug");
    await expect(deleteButton).toBeDisabled();

    // Correct slug enables it.
    await slugInput.fill(PROJECT_SLUG);
    await expect(deleteButton).toBeEnabled();
    await deleteButton.click();

    await signedInPage.waitForURL("/app/projects");

    // The deleted project is no longer in the list.
    await expect(signedInPage.getByRole("link", { name: new RegExp(PROJECT_NAME) })).toHaveCount(0);

    // And direct navigation to the deleted project 404s.
    const res = await signedInPage.goto(`/app/projects/${PROJECT_SLUG}`);
    expect(res?.status()).toBe(404);
  });
});
