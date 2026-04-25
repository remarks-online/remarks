import { EXT_ID, expect, test } from "./fixtures";

test("popup shows sign-in CTAs when no Clerk session is present", async ({ extensionContext }) => {
  const popup = await extensionContext.context.newPage();
  await popup.goto(`chrome-extension://${EXT_ID}/popup.html`);

  // The h1 renders outside any <Show>, so its presence proves the popup
  // bundle parsed and React mounted. Once that's true, the auth-conditional
  // content is just waiting on Clerk to commit a state.
  await expect(popup.getByRole("heading", { name: "Remarks" })).toBeVisible({ timeout: 30_000 });

  // ClerkProvider's <Show when="signed-in" fallback={…}> renders the
  // signed-out copy from apps/extension/src/entrypoints/popup/App.tsx:65-77.
  // Generous timeout because the SDK fetches its browser bundle from the dev
  // Clerk domain on first popup load — slow on cold CI runners.
  await expect(popup.getByText("Sign in to start annotating pages.")).toBeVisible({
    timeout: 30_000,
  });
  await expect(popup.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(popup.getByRole("button", { name: "Create account" })).toBeVisible();
});
