import { type DB, createClient, schema } from "@remarks/db";
import { expect, test } from "./fixtures.js";

const SPEC_PROJECT_NAME = "1.20 Error Boundaries";
const SPEC_PROJECT_SLUG = "e2e-1-20-error-boundaries";
const ANNOTATION_COMMENT = "1.20-e2e-banner-annotation-text";

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

test.describe("error boundaries and loading states", () => {
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

      await deleteProjectBySlug(db, sql, org.id, SPEC_PROJECT_SLUG);

      const [project] = await db
        .insert(schema.projects)
        .values({
          orgId: org.id,
          creatorUserId: user.id,
          name: SPEC_PROJECT_NAME,
          slug: SPEC_PROJECT_SLUG,
          primaryBranch: "main",
        })
        .returning();
      if (!project) throw new Error("project insert returned no rows");

      await db.insert(schema.projectMembers).values({
        projectId: project.id,
        userId: user.id,
        role: "admin",
      });

      const [branch] = await db
        .insert(schema.branches)
        .values({ projectId: project.id, name: "main" })
        .returning();
      if (!branch) throw new Error("branch insert returned no rows");

      await db.insert(schema.annotations).values({
        projectId: project.id,
        branchId: branch.id,
        authorId: user.id,
        targetType: "element",
        url: "https://acme.example.com/page",
        targetSelector: "h1",
        viewport: { width: 1440, height: 900, dpr: 2 },
        commentText: ANNOTATION_COMMENT,
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
      await deleteProjectBySlug(db, sql, org.id, SPEC_PROJECT_SLUG);
    });
  });

  test("client-side tRPC failure renders the stale-data banner without crashing", async ({
    signedInPage,
  }) => {
    // Poison client-side tRPC + SSE before navigation. RSC fetches happen
    // server-side in Next.js and aren't routed through the browser, so the
    // initial page render still gets real data — only client-side fetches
    // (tRPC poll, SSE) hit the 500. SSE must fail too: when it succeeds the
    // browser stops polling, so a tRPC outage would never surface as a banner.
    await signedInPage.route("**/trpc/**", (route) => route.fulfill({ status: 500, body: "" }));
    await signedInPage.route("**/projects/*/events", (route) =>
      route.fulfill({ status: 500, body: "" })
    );

    await signedInPage.goto(`/app/projects/${SPEC_PROJECT_SLUG}`);
    await expect(signedInPage.getByRole("heading", { name: SPEC_PROJECT_NAME })).toBeVisible();
    await expect(signedInPage.getByText(ANNOTATION_COMMENT)).toBeVisible();

    // Wait for refetchInterval (5s) + the QueryClient retry (1) to flip isError.
    await expect(signedInPage.getByText(/Couldn['’]t refresh annotations/i)).toBeVisible({
      timeout: 15_000,
    });

    // The previously-rendered list is still visible — no white screen.
    await expect(signedInPage.getByText(ANNOTATION_COMMENT)).toBeVisible();
  });

  test("unknown slug still renders the not-found page (no error-boundary regression)", async ({
    signedInPage,
  }) => {
    const res = await signedInPage.goto("/app/projects/does-not-exist-1-20");
    expect(res?.status()).toBe(404);
    await expect(signedInPage.getByRole("heading", { name: "Project not found" })).toBeVisible();
  });
});
