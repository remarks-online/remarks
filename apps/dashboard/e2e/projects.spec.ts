import { TEST_PROJECT_NAME } from "./constants.js";
import { expect, test } from "./fixtures.js";

test("signed-in user sees their org's projects on /app/projects", async ({ signedInPage }) => {
  await signedInPage.goto("/app/projects");
  await expect(signedInPage.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
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

test("signed-in user can create a personal project from the new-project form", async ({
  signedInPage,
}) => {
  // The fixture pins an org so the new-project form shows the scope picker.
  // We exercise the personal-scope branch by selecting it explicitly. (Calling
  // window.Clerk.setActive({organization:null}) doesn't propagate to the
  // server's auth() before the next render, so the picker shows regardless.)
  await signedInPage.goto("/app/projects/new");
  await expect(signedInPage.getByRole("heading", { name: "New project" })).toBeVisible();

  const unique = Date.now();
  const name = `Personal ${unique}`;
  const slug = `personal-${unique}`;

  // Pick the "Personal" radio so the form submits without orgId.
  await signedInPage.getByLabel("Personal").check();
  await signedInPage.getByLabel("Name").fill(name);
  await signedInPage.getByLabel("Slug").fill(slug);
  await signedInPage.getByRole("button", { name: "Create" }).click();

  await signedInPage.waitForURL(/\/app\/projects$/);
  // Personal projects render under the "Your projects" section label.
  await expect(signedInPage.getByText("Your projects")).toBeVisible();
  await expect(signedInPage.getByText(name)).toBeVisible();
});
