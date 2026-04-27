import { TEST_PROJECT_NAME } from "../../dashboard/e2e/constants";
import { EXT_ID, expect, test } from "./fixtures";

test("popup surfaces project picker for signed-in user with seeded project", async ({
  signedInExtensionContext,
}) => {
  const popup = await signedInExtensionContext.context.newPage();
  await popup.goto(`chrome-extension://${EXT_ID}/popup.html`);

  // The h1 renders outside any <Show>, proving the popup bundle parsed and
  // React mounted before we race ClerkProvider for auth-conditional content.
  await expect(popup.getByRole("heading", { name: "Remarks" })).toBeVisible({ timeout: 30_000 });

  // Signed-in branch of <Show when="signed-in"> in App.tsx — signed-out copy
  // must NOT be on the page. Generous timeout because Clerk's browser SDK
  // download is slow on cold CI runners.
  await expect(popup.getByText("Sign in to start annotating pages.")).toBeHidden({
    timeout: 30_000,
  });

  // ProjectPicker defaults to "Personal (private)" so a brand-new sign-in can
  // capture without picking a team — the seeded project is one of the dropdown
  // options. Wait for the picker label first so we know the picker mounted,
  // then expand the trigger and assert the seeded project is selectable.
  await expect(popup.getByText("Capture to")).toBeVisible({ timeout: 30_000 });
  await expect(popup.getByText("Personal (private)").first()).toBeVisible();

  await popup.getByRole("combobox", { name: "Capture to" }).click();
  await expect(popup.getByRole("option", { name: new RegExp(TEST_PROJECT_NAME) })).toBeVisible({
    timeout: 10_000,
  });
});
