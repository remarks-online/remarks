import { EXT_ID, expect, test } from "./fixtures";

test("popup shows sign-in CTAs when no Clerk session is present", async ({ extensionContext }) => {
  const popup = await extensionContext.context.newPage();
  await popup.goto(`chrome-extension://${EXT_ID}/popup.html`);

  // ClerkProvider's <Show when="signed-in" fallback={…}> renders the
  // signed-out copy from apps/extension/src/entrypoints/popup/App.tsx:65-77.
  await expect(popup.getByText("Sign in to start annotating pages.")).toBeVisible();
  await expect(popup.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(popup.getByRole("button", { name: "Create account" })).toBeVisible();
});
