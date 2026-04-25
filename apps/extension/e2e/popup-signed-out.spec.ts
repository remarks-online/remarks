import { EXT_ID, expect, test } from "./fixtures";

test("popup shows sign-in CTAs when no Clerk session is present", async ({ extensionContext }) => {
  const popup = await extensionContext.context.newPage();
  await popup.goto(`chrome-extension://${EXT_ID}/popup.html`);

  // ClerkProvider's <Show> won't render either branch (signed-in or fallback)
  // until Clerk's browser bundle has loaded. Cold CI runners take noticeably
  // longer than local — wait explicitly so the visibility assertion below
  // doesn't race with SDK init.
  await popup.waitForFunction(
    // @ts-expect-error - window.Clerk injected by ClerkProvider
    () => Boolean(window.Clerk?.loaded),
    null,
    { timeout: 30_000 }
  );

  // ClerkProvider's <Show when="signed-in" fallback={…}> renders the
  // signed-out copy from apps/extension/src/entrypoints/popup/App.tsx:65-77.
  await expect(popup.getByText("Sign in to start annotating pages.")).toBeVisible();
  await expect(popup.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(popup.getByRole("button", { name: "Create account" })).toBeVisible();
});
