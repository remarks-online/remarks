import { type DB, createClient, schema } from "@remarks/db";
import { expect, test } from "./fixtures.js";

// Verifies the personal-first onboarding wizard: any signed-in user without
// the skip cookie hits /app/onboarding and walks through three steps:
//   1. Install the extension (manual confirm — Playwright Chromium has no
//      extension loaded, so auto-detection times out)
//   2. Capture a personal annotation (simulated by a Drizzle insert into
//      annotations with projectId = null)
//   3. Install the MCP server (click "I've installed it" to confirm)
//   → Success card with links to /app/personal and /app/projects.
//
// No org/project provisioning is needed — onboarding is per-person now.

const SKIP_COOKIE_PREFIX = "remarks-onboarding-skipped:";

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

async function clearSkipState(): Promise<void> {
  const userId = process.env.E2E_CLERK_USER_ID;
  if (!userId) throw new Error("E2E_CLERK_USER_ID missing — global-setup did not run");
  await withDb(async ({ db, sql }) => {
    const user = await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.clerkUserId, userId),
      columns: { id: true },
    });
    if (!user) return;
    // Clean any personal annotations the e2e user has from previous runs so
    // step 2's wait-for-row actually waits.
    await sql`
      DELETE FROM annotations
      WHERE author_id = ${user.id} AND project_id IS NULL
    `;
  });
}

async function insertPersonalAnnotation(
  db: DB,
  userClerkId: string,
  marker: string
): Promise<void> {
  const user = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.clerkUserId, userClerkId),
    columns: { id: true },
  });
  if (!user) throw new Error("user not found for annotation seed");

  await db.insert(schema.annotations).values({
    projectId: null,
    branchId: null,
    authorId: user.id,
    targetType: "element",
    url: "https://acme.example.com/onboarding-test",
    targetSelector: "button.submit",
    viewport: { width: 1440, height: 900, dpr: 2 },
    commentText: marker,
  });
}

test.beforeEach(async ({ signedInPage }) => {
  await clearSkipState();
  // Drop the skip cookie if a previous test set it.
  const userId = process.env.E2E_CLERK_USER_ID;
  if (userId) {
    await signedInPage.context().clearCookies({ name: `${SKIP_COOKIE_PREFIX}${userId}` });
  }
});

test("any signed-in user is redirected from /app to /app/onboarding", async ({ signedInPage }) => {
  const response = await signedInPage.goto("/app");
  expect(response?.url()).toMatch(/\/app\/onboarding$/);
  await expect(
    signedInPage.getByRole("heading", { name: /Install the Remarks extension/ })
  ).toBeVisible();
});

test("walks install → personal annotation → MCP → success", async ({ signedInPage }) => {
  await signedInPage.goto("/app/onboarding");

  // Step 1 — install extension (manual confirm).
  await expect(
    signedInPage.getByRole("heading", { name: /Install the Remarks extension/ })
  ).toBeVisible();
  await signedInPage.getByRole("button", { name: /I've installed it/ }).click();

  // Step 2 — capture personal annotation (simulated server-side).
  await expect(
    signedInPage.getByRole("heading", { name: "Capture your first annotation", exact: true })
  ).toBeVisible();
  const marker = `e2e-onboarding-personal-${Date.now()}`;
  await withDb(async ({ db }) => {
    await insertPersonalAnnotation(db, process.env.E2E_CLERK_USER_ID ?? "", marker);
  });

  // Step 3 — install MCP. The list query polls every 5s, give it room.
  await expect(
    signedInPage.getByRole("heading", { name: /Connect an AI coding agent/ })
  ).toBeVisible({ timeout: 10_000 });
  await signedInPage.getByRole("button", { name: /I've installed it/ }).click();

  // Success card with quoted comment + the two CTAs.
  await expect(signedInPage.getByRole("heading", { name: /Welcome to Remarks/ })).toBeVisible();
  await expect(signedInPage.getByText(marker)).toBeVisible();
  await expect(signedInPage.getByRole("link", { name: /View my annotations/ })).toBeVisible();
  await expect(signedInPage.getByRole("link", { name: /Create a team project/ })).toBeVisible();
});

test("skip onboarding sets the skip cookie and redirects future /app visits", async ({
  signedInPage,
}) => {
  const first = await signedInPage.goto("/app");
  expect(first?.url()).toMatch(/\/app\/onboarding$/);

  await signedInPage.getByRole("button", { name: "Skip onboarding" }).click();
  await signedInPage.waitForURL(/\/app\/projects$/);

  const second = await signedInPage.goto("/app");
  expect(second?.url()).toMatch(/\/app\/projects$/);
});
