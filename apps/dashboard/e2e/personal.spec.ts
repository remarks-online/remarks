import { type DB, createClient, schema } from "@remarks/db";
import { expect, test } from "./fixtures.js";

test.describe("personal annotations detail sheet", () => {
  const COMMENT = "1.x-e2e-personal-annotation-text";

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

  async function deletePersonalAnnotationsForUser(
    db: DB,
    sql: ReturnType<typeof createClient>["sql"],
    userId: string
  ): Promise<void> {
    await sql`DELETE FROM annotations WHERE project_id IS NULL AND author_id = ${userId}`;
  }

  let seededAnnotationId = "";

  test.beforeEach(async () => {
    await withDb(async ({ db, sql }) => {
      const clerkUserId = process.env.E2E_CLERK_USER_ID;
      if (!clerkUserId) {
        throw new Error("E2E_CLERK_USER_ID must be set by global-setup");
      }
      const user = await db.query.users.findFirst({
        where: (u, { eq }) => eq(u.clerkUserId, clerkUserId),
      });
      if (!user) throw new Error("global-setup did not seed the expected user");

      // Each test wants a clean slate so delete asserts an empty list.
      await deletePersonalAnnotationsForUser(db, sql, user.id);

      const [annotation] = await db
        .insert(schema.annotations)
        .values({
          projectId: null,
          branchId: null,
          authorId: user.id,
          targetType: "element",
          url: "https://example.com/personal",
          targetSelector: "main",
          viewport: { width: 1440, height: 900, dpr: 2 },
          commentText: COMMENT,
        })
        .returning();
      if (!annotation) throw new Error("personal annotation insert returned no rows");
      seededAnnotationId = annotation.id;
    });
  });

  test.afterAll(async () => {
    await withDb(async ({ db, sql }) => {
      const clerkUserId = process.env.E2E_CLERK_USER_ID;
      if (!clerkUserId) return;
      const user = await db.query.users.findFirst({
        where: (u, { eq }) => eq(u.clerkUserId, clerkUserId),
      });
      if (!user) return;
      await deletePersonalAnnotationsForUser(db, sql, user.id);
    });
  });

  test("title click opens sheet, status change reflects in list", async ({ signedInPage }) => {
    await signedInPage.goto("/app/personal");

    const titleButton = signedInPage.getByRole("button", { name: COMMENT });
    await expect(titleButton).toBeVisible();
    await titleButton.click();

    await expect(signedInPage).toHaveURL(new RegExp(`\\?a=${seededAnnotationId}$`));
    const drawer = signedInPage.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(COMMENT)).toBeVisible();

    const statusSelect = drawer.getByRole("combobox", { name: "Status" });
    await expect(statusSelect).toContainText("To do");
    await statusSelect.click();
    await signedInPage.getByRole("option", { name: "Done" }).click();
    await expect(statusSelect).toContainText("Done");

    await signedInPage.keyboard.press("Escape");
    await expect(signedInPage).toHaveURL("/app/personal");
  });

  test("edit comment updates the row title", async ({ signedInPage }) => {
    await signedInPage.goto(`/app/personal?a=${seededAnnotationId}`);
    const drawer = signedInPage.getByRole("dialog");
    await expect(drawer).toBeVisible();

    await drawer.getByRole("button", { name: "Edit" }).click();
    const textarea = drawer.getByRole("textbox", { name: "Annotation comment" });
    const newText = `${COMMENT}-edited`;
    await textarea.fill(newText);
    await drawer.getByRole("button", { name: "Save" }).click();

    await expect(drawer.getByText(newText)).toBeVisible();
    await signedInPage.keyboard.press("Escape");

    await expect(signedInPage.getByRole("button", { name: newText })).toBeVisible();
  });

  test("delete removes the row and closes the sheet", async ({ signedInPage }) => {
    await signedInPage.goto(`/app/personal?a=${seededAnnotationId}`);
    const drawer = signedInPage.getByRole("dialog");
    await expect(drawer).toBeVisible();

    // The sheet calls window.confirm() — auto-accept the native dialog.
    signedInPage.once("dialog", (dialog) => {
      void dialog.accept();
    });
    await drawer.getByRole("button", { name: /Delete annotation/ }).click();

    await expect(drawer).not.toBeVisible();
    await expect(signedInPage.getByRole("button", { name: COMMENT })).not.toBeVisible();
    await expect(signedInPage.getByText("No personal annotations yet")).toBeVisible();
  });
});
