import type { Page } from "@playwright/test";
import { type DB, createClient, schema } from "@remarks/db";
import { ensureClerkOrg, ensureClerkOrgMembership } from "./clerk.js";
import { expect, test } from "./fixtures.js";

// Verifies task 1.34: a signed-in user with zero projects in the active org
// hits /app/onboarding, walks step 1 (create project) → step 2 (install
// extension, auto-detected via the externally_connectable ping) → step 3
// (capture first annotation, simulated by a Drizzle insert) → success.
//
// We provision a fresh Clerk org just for this spec because the default test
// org seeded by global-setup.ts already owns a project. The wizard's "skip
// step 1 when projects already exist" branch makes the create flow
// unreachable from the default org; a clean org gives us a deterministic
// zero-projects starting state.

const SPEC_ORG_NAME = "1.34 Onboarding Org";
const SPEC_PROJECT_NAME_PREFIX = "1.34 Onboarding Project";
const SPEC_PROJECT_SLUG_PREFIX = "e2e-onboarding";

let specOrgId = "";
let specOrgSlug = "";

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

async function deleteAllProjectsForClerkOrg(clerkOrgId: string): Promise<void> {
  await withDb(async ({ db, sql }) => {
    const org = await db.query.organizations.findFirst({
      where: (o, { eq }) => eq(o.clerkOrgId, clerkOrgId),
      columns: { id: true },
    });
    if (!org) return;
    // FK cascades wipe branches + annotations + members.
    await sql`DELETE FROM projects WHERE org_id = ${org.id}`;
  });
}

async function pinSpecOrg(page: Page): Promise<void> {
  if (!specOrgId) throw new Error("specOrgId missing — beforeAll did not run");
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
  }, specOrgId);
}

// We deliberately don't stub `chrome.runtime.sendMessage` here. Playwright
// Chromium has no extension loaded, so the wizard's extension-detect helper
// returns `{installed:false}` and the auto-advance never fires. The test
// drives step 2 → step 3 via the manual "I've installed it" button, which
// gives us a deterministic window for the step-2 heading assertion. The
// auto-detection path is exercised by hand in the manual-smoke checklist.

test.beforeAll(async () => {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const userId = process.env.E2E_CLERK_USER_ID;
  if (!secretKey?.startsWith("sk_test_")) {
    throw new Error("CLERK_SECRET_KEY must be a dev (sk_test_*) key for the onboarding org");
  }
  if (!userId) throw new Error("E2E_CLERK_USER_ID missing — global-setup did not run");

  const org = await ensureClerkOrg(secretKey, SPEC_ORG_NAME, userId);
  specOrgId = org.id;
  specOrgSlug = org.slug;
  await ensureClerkOrgMembership(secretKey, org.id, userId, "org:admin");

  // Webhook may not have fired against the local API in dev (no public ngrok).
  // Mirror Clerk org → DB row so /app's projects.list query lands on the
  // correct organizations row instead of returning unrelated projects.
  await withDb(async ({ db }) => {
    await db
      .insert(schema.organizations)
      .values({ clerkOrgId: org.id, name: SPEC_ORG_NAME, slug: org.slug })
      .onConflictDoUpdate({
        target: schema.organizations.clerkOrgId,
        set: { name: SPEC_ORG_NAME, slug: org.slug, updatedAt: new Date() },
      });
  });

  // Start from a clean slate every run.
  await deleteAllProjectsForClerkOrg(org.id);
});

test.afterEach(async () => {
  if (!specOrgId) return;
  await deleteAllProjectsForClerkOrg(specOrgId);
});

test("zero-projects user is redirected from /app to /app/onboarding", async ({ signedInPage }) => {
  await pinSpecOrg(signedInPage);

  const response = await signedInPage.goto("/app");
  expect(response?.url()).toMatch(/\/app\/onboarding$/);
  await expect(
    signedInPage.getByRole("heading", { name: /Create your first project/ })
  ).toBeVisible();
});

test("walks create → install (manual confirm) → first annotation → success", async ({
  signedInPage,
}) => {
  await pinSpecOrg(signedInPage);

  await signedInPage.goto("/app/onboarding");

  // Step 1 — create project.
  const unique = Date.now();
  const projectName = `${SPEC_PROJECT_NAME_PREFIX} ${unique}`;
  const projectSlug = `${SPEC_PROJECT_SLUG_PREFIX}-${unique}`;
  await expect(
    signedInPage.getByRole("heading", { name: /Create your first project/ })
  ).toBeVisible();
  await signedInPage.getByLabel("Name").fill(projectName);
  await signedInPage.getByLabel("Slug").fill(projectSlug);
  await signedInPage.getByRole("button", { name: "Create project" }).click();

  // Step 2 — install extension. Playwright Chromium has no extension loaded,
  // so auto-detection times out. Manually confirm via the always-rendered
  // fallback button.
  await expect(
    signedInPage.getByRole("heading", { name: /Install the Remarks extension/ })
  ).toBeVisible();
  await signedInPage.getByRole("button", { name: /I've installed it/ }).click();

  // Step 3 — capture first annotation; simulate by inserting a row directly.
  await expect(
    signedInPage.getByRole("heading", { name: "Capture your first annotation", exact: true })
  ).toBeVisible();

  await withDb(async ({ db }) => {
    const org = await db.query.organizations.findFirst({
      where: (o, { eq }) => eq(o.clerkOrgId, specOrgId),
      columns: { id: true },
    });
    const project = org
      ? await db.query.projects.findFirst({
          where: (p, { and, eq }) => and(eq(p.orgId, org.id), eq(p.slug, projectSlug)),
          columns: { id: true, primaryBranch: true },
        })
      : null;
    const user = await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.clerkUserId, process.env.E2E_CLERK_USER_ID ?? ""),
      columns: { id: true },
    });
    if (!project || !user) throw new Error("project/user not found for annotation seed");

    const [branch] = await db
      .insert(schema.branches)
      .values({ projectId: project.id, name: project.primaryBranch })
      .onConflictDoNothing()
      .returning({ id: schema.branches.id });
    const branchId =
      branch?.id ??
      (
        await db.query.branches.findFirst({
          where: (b, { and, eq }) =>
            and(eq(b.projectId, project.id), eq(b.name, project.primaryBranch)),
          columns: { id: true },
        })
      )?.id;
    if (!branchId) throw new Error("branch resolve failed");

    await db.insert(schema.annotations).values({
      projectId: project.id,
      branchId,
      authorId: user.id,
      targetType: "element",
      url: "https://acme.example.com/checkout",
      targetSelector: "button.submit",
      viewport: { width: 1440, height: 900, dpr: 2 },
      commentText: "1.34-onboarding-first-annotation",
    });
  });

  // Step 4 — success card. The list query polls every 5s, give it room.
  await expect(signedInPage.getByRole("heading", { name: /Welcome to Remarks/ })).toBeVisible({
    timeout: 10_000,
  });
  await expect(signedInPage.getByText("1.34-onboarding-first-annotation")).toBeVisible();
  await expect(
    signedInPage.getByRole("link", { name: new RegExp(`View in ${projectName}`) })
  ).toBeVisible();
});

test("skip onboarding sets the skip cookie and redirects future /app visits", async ({
  signedInPage,
}) => {
  await pinSpecOrg(signedInPage);

  // Land on /app — should redirect to /app/onboarding because zero projects.
  const first = await signedInPage.goto("/app");
  expect(first?.url()).toMatch(/\/app\/onboarding$/);

  await signedInPage.getByRole("button", { name: "Skip onboarding" }).click();
  await signedInPage.waitForURL(/\/app\/projects$/);

  // Subsequent /app visits should now go straight to /app/projects (skip cookie).
  const second = await signedInPage.goto("/app");
  expect(second?.url()).toMatch(/\/app\/projects$/);
});

// specOrgSlug isn't asserted on in any test path, but referenced via Clerk to
// keep idempotent provisioning stable. Keep the binding hot to silence Biome's
// noUnusedVariables on the import surface.
void specOrgSlug;
