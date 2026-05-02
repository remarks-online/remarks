import { type DB, createClient, schema } from "@remarks/db";
import { TEST_PROJECT_NAME, TEST_PROJECT_SLUG } from "./constants.js";
import { expect, test } from "./fixtures.js";

test("list → detail navigation shows project header + default-branch label", async ({
  signedInPage,
}) => {
  await signedInPage.goto("/app/projects");
  await signedInPage.getByRole("link", { name: new RegExp(TEST_PROJECT_NAME) }).click();
  await signedInPage.waitForURL(`/app/projects/${TEST_PROJECT_SLUG}`);
  await expect(signedInPage.getByRole("heading", { name: TEST_PROJECT_NAME })).toBeVisible();
  await expect(signedInPage.getByText("default branch:")).toBeVisible();
});

test("project with no annotations shows the empty state and back link works", async ({
  signedInPage,
}) => {
  await signedInPage.goto(`/app/projects/${TEST_PROJECT_SLUG}`);
  await expect(signedInPage.getByText("No annotations yet")).toBeVisible();
  await signedInPage.getByRole("link", { name: /Back to projects/ }).click();
  await signedInPage.waitForURL("/app/projects");
});

test("unknown slug renders the 404 not-found page", async ({ signedInPage }) => {
  const res = await signedInPage.goto("/app/projects/does-not-exist-1-14");
  expect(res?.status()).toBe(404);
  await expect(signedInPage.getByRole("heading", { name: "Project not found" })).toBeVisible();
});

test.describe("annotations grouped by branch", () => {
  // Seed a throwaway project so the shared E2E Seed Project (asserted empty
  // above) stays untouched. Project FK cascades wipe branches + annotations
  // in afterAll.
  const SPEC_PROJECT_NAME = "1.14 Branch Grouping";
  const SPEC_PROJECT_SLUG = "e2e-1-14-branch-grouping";

  async function withDb<T>(
    fn: (client: ReturnType<typeof createClient>) => Promise<T>
  ): Promise<T> {
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
    // Drizzle's `db.delete` needs `eq` from drizzle-orm, which isn't a direct
    // dashboard dep. Raw SQL via the postgres.js tagged template sidesteps
    // that; FK cascades still wipe branches/annotations.
    await sql`DELETE FROM projects WHERE id = ${existing.id}`;
  }

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

      // Clean up a leftover run-of-the-same-spec, in case a previous failure
      // aborted afterAll. Cascades to branches/annotations.
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

      const [mainBranch] = await db
        .insert(schema.branches)
        .values({ projectId: project.id, name: "main" })
        .returning();
      const [featureBranch] = await db
        .insert(schema.branches)
        .values({ projectId: project.id, name: "feature/e2e-detail" })
        .returning();
      if (!mainBranch || !featureBranch) throw new Error("branch insert returned no rows");

      await db.insert(schema.annotations).values([
        {
          projectId: project.id,
          branchId: mainBranch.id,
          authorId: user.id,
          targetType: "element",
          url: "https://acme.example.com/home",
          targetSelector: "h1",
          viewport: { width: 1440, height: 900, dpr: 2 },
          commentText: "1.14-e2e-main-annotation-text",
        },
        {
          projectId: project.id,
          branchId: featureBranch.id,
          authorId: user.id,
          targetType: "route",
          url: "https://acme.example.com/checkout",
          viewport: { width: 1440, height: 900, dpr: 2 },
          commentText: "1.14-e2e-feature-annotation-text",
        },
      ]);
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

  test("renders both branch sections + annotation comments", async ({ signedInPage }) => {
    await signedInPage.goto(`/app/projects/${SPEC_PROJECT_SLUG}`);
    await expect(signedInPage.getByRole("heading", { name: SPEC_PROJECT_NAME })).toBeVisible();

    // Branch names are rendered inside <code> under <h2>; getByRole picks the
    // heading and the code-inside-heading doesn't get its own role.
    const mainHeading = signedInPage.getByRole("heading", { name: /^main$/ });
    const featureHeading = signedInPage.getByRole("heading", { name: "feature/e2e-detail" });
    await expect(mainHeading).toBeVisible();
    await expect(featureHeading).toBeVisible();

    // Primary branch ("main") must render first; the feature branch follows.
    const mainBox = await mainHeading.boundingBox();
    const featureBox = await featureHeading.boundingBox();
    if (!mainBox || !featureBox) throw new Error("branch heading not laid out");
    expect(mainBox.y).toBeLessThan(featureBox.y);

    await expect(signedInPage.getByText("1.14-e2e-main-annotation-text")).toBeVisible();
    await expect(signedInPage.getByText("1.14-e2e-feature-annotation-text")).toBeVisible();
  });
});

test.describe("annotation detail drawer", () => {
  const SPEC_PROJECT_NAME = "1.15 Detail Drawer";
  const SPEC_PROJECT_SLUG = "e2e-1-15-detail-drawer";
  const ANNOTATION_COMMENT = "1.15-e2e-drawer-annotation-text";

  async function withDb<T>(
    fn: (client: ReturnType<typeof createClient>) => Promise<T>
  ): Promise<T> {
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

  let seededAnnotationId = "";

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

      const [annotation] = await db
        .insert(schema.annotations)
        .values({
          projectId: project.id,
          branchId: branch.id,
          authorId: user.id,
          targetType: "element",
          url: "https://acme.example.com/checkout",
          targetSelector: "button.submit",
          viewport: { width: 1440, height: 900, dpr: 2 },
          commentText: ANNOTATION_COMMENT,
          // G14: a populated `_debugSource` shape so the detail drawer can
          // assert the Source row renders. Mirrors what the extension's
          // fiber-bridge produces in dev.
          frameworkHint: "react",
          domContext: {
            tagName: "button",
            classes: ["submit"],
            reactComponents: [
              {
                name: "SubmitButton",
                kind: "function",
                source: {
                  fileName: "src/components/SubmitButton.tsx",
                  lineNumber: 42,
                  columnNumber: 10,
                },
              },
              { name: "CheckoutForm", kind: "function" },
            ],
          },
        })
        .returning();
      if (!annotation) throw new Error("annotation insert returned no rows");
      seededAnnotationId = annotation.id;

      await db.insert(schema.annotationEvents).values({
        annotationId: annotation.id,
        actorType: "user",
        actorId: user.id,
        type: "created",
        payload: {},
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

  test("opens drawer on card click, changes status, reflects on list", async ({ signedInPage }) => {
    await signedInPage.goto(`/app/projects/${SPEC_PROJECT_SLUG}`);

    // Card text is an <p> inside a <button>; click the button by its aria-label.
    const cardButton = signedInPage.getByRole("button", {
      name: new RegExp(`Open annotation: ${ANNOTATION_COMMENT}`),
    });
    await expect(cardButton).toBeVisible();
    await cardButton.click();

    // URL reflects the selected annotation id.
    await expect(signedInPage).toHaveURL(new RegExp(`\\?a=${seededAnnotationId}$`));

    // Drawer shows the full comment, the status dropdown, and the activity list.
    const drawer = signedInPage.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(ANNOTATION_COMMENT)).toBeVisible();

    const statusSelect = drawer.getByRole("combobox", { name: "Status" });
    await expect(statusSelect).toContainText("To do");

    // Activity timeline includes the "created" event.
    await expect(drawer.getByText(/created this/i)).toBeVisible();

    // Change status to Done via the Radix Select.
    await statusSelect.click();
    await signedInPage.getByRole("option", { name: "Done" }).click();

    // After the mutation resolves, the trigger reflects the new value and a new
    // event row is rendered.
    await expect(statusSelect).toContainText("Done");
    await expect(drawer.getByText(/changed status: To do → Done/i)).toBeVisible();

    // Close the drawer via Escape; URL loses the `?a=` param.
    await signedInPage.keyboard.press("Escape");
    await expect(signedInPage).toHaveURL(`/app/projects/${SPEC_PROJECT_SLUG}`);

    // The card now shows the updated status badge.
    await expect(
      signedInPage
        .getByRole("button", { name: new RegExp(`Open annotation: ${ANNOTATION_COMMENT}`) })
        .getByText("Done")
    ).toBeVisible();
  });

  test("deep-link via ?a= opens the drawer on reload", async ({ signedInPage }) => {
    await signedInPage.goto(`/app/projects/${SPEC_PROJECT_SLUG}?a=${seededAnnotationId}`);
    const drawer = signedInPage.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(ANNOTATION_COMMENT)).toBeVisible();
  });

  // G14: when `domContext.reactComponents[i].source` is set, the metadata
  // panel surfaces the leaf-most populated entry as a Source row. Pinned via
  // e2e because the same fact is asserted server-side in the MCP integration
  // test — together they cover the full capture → API → dashboard path.
  test("metadata panel shows Source row when reactComponents carry _debugSource", async ({
    signedInPage,
  }) => {
    await signedInPage.goto(`/app/projects/${SPEC_PROJECT_SLUG}?a=${seededAnnotationId}`);
    const drawer = signedInPage.getByRole("dialog");
    await expect(drawer).toBeVisible();

    await expect(drawer.getByText("Source", { exact: true })).toBeVisible();
    await expect(drawer.getByText("src/components/SubmitButton.tsx:42:10")).toBeVisible();
  });
});

test.describe("annotation list filters (D2)", () => {
  const SPEC_PROJECT_NAME = "D2 Filters";
  const SPEC_PROJECT_SLUG = "e2e-d2-filters";
  const COMMENT_PREFIX = "d2-filter-";

  // Fix + Blocking is the most-narrowed pair; the other rows exercise each
  // axis independently so we can assert correct narrowing on either axis
  // alone, then on both combined.
  const SEED = [
    { key: "alpha", intent: "fix", severity: "blocking" },
    { key: "beta", intent: "fix", severity: "suggestion" },
    { key: "gamma", intent: "change", severity: "important" },
    { key: "delta", intent: null, severity: null },
  ] as const;

  function commentFor(key: string): string {
    return `${COMMENT_PREFIX}${key}`;
  }

  async function withDb<T>(
    fn: (client: ReturnType<typeof createClient>) => Promise<T>
  ): Promise<T> {
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

      await db.insert(schema.annotations).values(
        SEED.map((row) => ({
          projectId: project.id,
          branchId: branch.id,
          authorId: user.id,
          targetType: "element" as const,
          url: "https://acme.example.com/home",
          targetSelector: `[data-d2="${row.key}"]`,
          viewport: { width: 1440, height: 900, dpr: 2 },
          commentText: commentFor(row.key),
          intent: row.intent,
          severity: row.severity,
        }))
      );
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

  test("intent + severity filters narrow the annotation list", async ({ signedInPage }) => {
    await signedInPage.goto(`/app/projects/${SPEC_PROJECT_SLUG}`);

    const cardFor = (key: string) =>
      signedInPage.getByRole("button", {
        name: new RegExp(`Open annotation: ${commentFor(key)}`),
      });

    // 1. No filter → all four cards.
    for (const row of SEED) {
      await expect(cardFor(row.key)).toBeVisible();
    }

    // 2. Intent = Fix → alpha + beta visible, gamma + delta hidden.
    const intentSelect = signedInPage.getByRole("combobox", { name: "Filter by intent" });
    await intentSelect.click();
    await signedInPage.getByRole("option", { name: "Fix" }).click();

    await expect(signedInPage).toHaveURL(/[?&]intent=fix(?:&|$)/);
    await expect(cardFor("alpha")).toBeVisible();
    await expect(cardFor("beta")).toBeVisible();
    await expect(cardFor("gamma")).toHaveCount(0);
    await expect(cardFor("delta")).toHaveCount(0);

    // 3. Add Severity = Blocking → only alpha.
    const severitySelect = signedInPage.getByRole("combobox", { name: "Filter by severity" });
    await severitySelect.click();
    await signedInPage.getByRole("option", { name: "Blocking" }).click();

    await expect(signedInPage).toHaveURL(/[?&]intent=fix(?:&|$)/);
    await expect(signedInPage).toHaveURL(/[?&]severity=blocking(?:&|$)/);
    await expect(cardFor("alpha")).toBeVisible();
    await expect(cardFor("beta")).toHaveCount(0);
    await expect(cardFor("gamma")).toHaveCount(0);
    await expect(cardFor("delta")).toHaveCount(0);

    // The badge rendering contract from ADR-0016: alpha shows both Fix and
    // Blocking badges. Scope to the card so we don't match the filter labels.
    const alphaCard = cardFor("alpha");
    await expect(alphaCard.getByText("Fix", { exact: true })).toBeVisible();
    await expect(alphaCard.getByText("Blocking", { exact: true })).toBeVisible();

    // 4. Reset both filters → all four cards return; URL params cleared.
    await intentSelect.click();
    await signedInPage.getByRole("option", { name: "All intents" }).click();
    await severitySelect.click();
    await signedInPage.getByRole("option", { name: "All severities" }).click();

    await expect(signedInPage).toHaveURL(`/app/projects/${SPEC_PROJECT_SLUG}`);
    for (const row of SEED) {
      await expect(cardFor(row.key)).toBeVisible();
    }
  });
});

test.describe("annotation export (G18)", () => {
  const SPEC_PROJECT_NAME = "G18 Export";
  const SPEC_PROJECT_SLUG = "e2e-g18-export";
  const COMMENT_ALPHA = "g18-export-alpha-comment";
  const COMMENT_BETA = "g18-export-beta-comment";

  async function withDb<T>(
    fn: (client: ReturnType<typeof createClient>) => Promise<T>
  ): Promise<T> {
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

      await db.insert(schema.annotations).values([
        {
          projectId: project.id,
          branchId: branch.id,
          authorId: user.id,
          targetType: "element",
          url: "https://acme.example.com/checkout",
          targetSelector: "button.submit",
          viewport: { width: 1440, height: 900, dpr: 2 },
          commentText: COMMENT_ALPHA,
          intent: "fix",
          severity: "blocking",
        },
        {
          projectId: project.id,
          branchId: branch.id,
          authorId: user.id,
          targetType: "element",
          url: "https://acme.example.com/profile",
          targetSelector: "input[name=email]",
          viewport: { width: 1440, height: 900, dpr: 2 },
          commentText: COMMENT_BETA,
          intent: "question",
          severity: null,
        },
      ]);
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

  test("Copy as markdown writes a rendered list to the clipboard", async ({ signedInPage }) => {
    // Chromium gates clipboard reads behind a per-origin permission. Granting
    // both read+write keeps the test free of permission prompts; the runtime
    // path the user takes only needs write, but read is required for the
    // Playwright readback assertion.
    await signedInPage.context().grantPermissions(["clipboard-read", "clipboard-write"]);

    await signedInPage.goto(`/app/projects/${SPEC_PROJECT_SLUG}`);
    await expect(signedInPage.getByText(COMMENT_ALPHA)).toBeVisible();
    await expect(signedInPage.getByText(COMMENT_BETA)).toBeVisible();

    await signedInPage.getByRole("button", { name: "Export annotations as markdown" }).click();
    await signedInPage.getByRole("menuitem", { name: "Copy as markdown" }).click();

    await expect(signedInPage.getByText(/Copied 2 annotations as markdown/)).toBeVisible();

    const clipboard = await signedInPage.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain(`# Remarks export — ${SPEC_PROJECT_NAME}`);
    expect(clipboard).toContain("Branch: `main`");
    expect(clipboard).toContain(COMMENT_ALPHA);
    expect(clipboard).toContain(COMMENT_BETA);
    expect(clipboard).toContain("[to_do] [fix] [blocking]");
    expect(clipboard).toContain("[to_do] [question]");
    expect(clipboard).toContain("- **Target:** element — `button.submit`");
  });
});

test.describe("annotation list pagination (A1)", () => {
  // PAGE_SIZE + 1 so exactly one row spills onto page 2 when "Load more" fires.
  const PAGE_SIZE = 50;
  const SEED_COUNT = PAGE_SIZE + 1;
  const SPEC_PROJECT_NAME = "A1 Pagination";
  const SPEC_PROJECT_SLUG = "e2e-a1-pagination";
  const COMMENT_PREFIX = "a1-pagination-";

  function commentFor(index: number): string {
    return `${COMMENT_PREFIX}${index.toString().padStart(2, "0")}`;
  }

  async function withDb<T>(
    fn: (client: ReturnType<typeof createClient>) => Promise<T>
  ): Promise<T> {
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

      // Stagger createdAt so DESC ordering is deterministic — index 0 is the
      // oldest (lands on page 2), index SEED_COUNT-1 is the newest (top of
      // page 1). Without explicit timestamps a single batch insert shares
      // createdAt to microsecond precision, leaving page assignment up to
      // random UUID order.
      const baseTime = Date.now() - SEED_COUNT * 1_000;
      await db.insert(schema.annotations).values(
        Array.from({ length: SEED_COUNT }, (_, i) => ({
          projectId: project.id,
          branchId: branch.id,
          authorId: user.id,
          targetType: "element" as const,
          url: "https://acme.example.com/home",
          targetSelector: "h1",
          viewport: { width: 1440, height: 900, dpr: 2 },
          commentText: commentFor(i),
          createdAt: new Date(baseTime + i * 1_000),
        }))
      );
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

  test("shows Load more, loads page 2, then hides the button", async ({ signedInPage }) => {
    await signedInPage.goto(`/app/projects/${SPEC_PROJECT_SLUG}`);

    // Newest row (page 1) renders; oldest row (page 2) does not yet.
    await expect(signedInPage.getByText(commentFor(SEED_COUNT - 1))).toBeVisible();
    await expect(signedInPage.getByText(commentFor(0))).toHaveCount(0);

    const loadMore = signedInPage.getByRole("button", { name: "Load more" });
    await expect(loadMore).toBeVisible();
    await loadMore.click();

    await expect(signedInPage.getByText(commentFor(0))).toBeVisible();
    await expect(loadMore).toHaveCount(0);
  });
});
