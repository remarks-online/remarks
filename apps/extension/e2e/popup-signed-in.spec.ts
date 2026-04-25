import { TEST_PROJECT_NAME } from "../../dashboard/e2e/constants";
import { EXT_ID, expect, test } from "./fixtures";

test("popup surfaces project picker for signed-in user with seeded project", async ({
  signedInExtensionContext,
}) => {
  const popup = await signedInExtensionContext.context.newPage();
  await popup.goto(`chrome-extension://${EXT_ID}/popup.html`);

  // Wait for Clerk's browser SDK to finish loading inside the popup so <Show>
  // commits to the signed-in branch before assertions run. Cold CI runners
  // need this explicit gate; locally the SDK loads fast enough that the
  // assertion's auto-retry covers the race.
  await popup.waitForFunction(
    // @ts-expect-error - window.Clerk injected by ClerkProvider
    () => Boolean(window.Clerk?.loaded),
    null,
    { timeout: 30_000 }
  );

  // Signed-in branch of <Show when="signed-in"> in App.tsx — signed-out copy
  // must NOT be on the page. Using `toBeHidden` rather than `not.toBeVisible`
  // because Clerk hydration is async; this asserts the element is absent or
  // hidden, with Playwright's auto-retry.
  await expect(popup.getByText("Sign in to start annotating pages.")).toBeHidden();

  // ProjectPicker fetches via trpc.projects.list and renders SelectItems whose
  // labels are `${name} — ${slug}` (apps/extension/src/entrypoints/popup/ProjectPicker.tsx:114-117).
  // The selected item shows the same label in the SelectTrigger via SelectValue.
  // Generous timeout: covers Clerk session sync + tRPC roundtrip.
  await expect(popup.getByText(TEST_PROJECT_NAME, { exact: false })).toBeVisible({
    timeout: 30_000,
  });
});
