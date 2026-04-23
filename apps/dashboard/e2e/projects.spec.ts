import { TEST_PROJECT_NAME } from "./constants.js";
import { expect, test } from "./fixtures.js";

test("signed-in user sees their org's projects on /app/projects", async ({ signedInPage }) => {
  await signedInPage.goto("/app/projects");
  await expect(signedInPage.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(signedInPage.getByText(TEST_PROJECT_NAME)).toBeVisible();
});

test("signed-in admin can create a project", async ({ signedInPage }) => {
  await signedInPage.goto("/app/projects");
  await signedInPage.getByRole("link", { name: "New project" }).click();
  await expect(signedInPage).toHaveURL(/\/app\/projects\/new$/);

  const unique = Date.now();
  const name = `E2E Project ${unique}`;
  const slug = `e2e-${unique}`;

  await signedInPage.getByLabel("Name").fill(name);
  await signedInPage.getByLabel("Slug").fill(slug);
  await signedInPage.getByRole("button", { name: "Create" }).click();

  await signedInPage.waitForURL(/\/app\/projects$/);
  await expect(signedInPage.getByText(name)).toBeVisible();
});
