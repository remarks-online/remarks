import { TEST_PROJECT_NAME } from "./constants.js";
import { expect, test } from "./fixtures.js";

test("signed-in user sees their org's projects on /app/projects", async ({ signedInPage }) => {
  await signedInPage.goto("/app/projects");
  await expect(signedInPage.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(signedInPage.getByText(TEST_PROJECT_NAME)).toBeVisible();
});
