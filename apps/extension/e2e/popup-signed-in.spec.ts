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

  // ProjectPicker fetches via trpc.projects.list and renders SelectItems whose
  // labels are `${name} — ${slug}` (apps/extension/src/entrypoints/popup/ProjectPicker.tsx:114-117).
  // The selected item shows the same label in the SelectTrigger via SelectValue.
  // Generous timeout: covers Clerk session sync + tRPC roundtrip.
  await expect(popup.getByText(TEST_PROJECT_NAME, { exact: false })).toBeVisible({
    timeout: 30_000,
  });
});
