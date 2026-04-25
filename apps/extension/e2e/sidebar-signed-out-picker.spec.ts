import { expect, test } from "./fixtures";

test("picker is gated while signed out and surfaces the sign-in card", async ({
  extensionContext,
}) => {
  const page = await extensionContext.context.newPage();

  // Same fake-host trick as sidebar-injection.spec.ts: <all_urls> permission
  // means the content script gets injected even on routed pages.
  await page.route("**/*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body><h1>host</h1></body></html>",
    });
  });
  await page.goto("http://remarks.test/");
  await page.waitForLoadState("load");

  const shadowHost = page.locator("remarks-sidebar");
  await expect(shadowHost).toBeAttached({ timeout: 15_000 });

  // Confirm the signed-out card is the body content first (otherwise the test
  // would still pass against a half-fixed implementation where C/R are gated
  // but the sidebar is hidden).
  await expect(page.getByText("Sign in to Remarks")).toBeVisible({ timeout: 15_000 });

  // Pressing C / R while signed out must not activate either picker session.
  // Picker overlays are appended to document.body with these ids
  // (apps/extension/src/lib/picker-controller.ts:15-21), so their absence is a
  // strong signal nothing fired. Click the host-page <h1> (not body — Playwright
  // pierces the sidebar's shadow root, so `body` matches two elements) to put
  // focus on the host page before dispatching keys.
  await page.getByRole("heading", { name: "host" }).click();
  await page.keyboard.press("c");
  await expect(page.locator("#rmk-picker-overlay")).toHaveCount(0);
  await expect(page.locator("body.rmk-picker-active")).toHaveCount(0);

  await page.keyboard.press("r");
  await expect(page.locator("#rmk-rect-overlay")).toHaveCount(0);
  await expect(page.locator("body.rmk-rect-active")).toHaveCount(0);

  // The sidebar's signed-out card should still be the visible body — pressing
  // a picker key while signed out also forces the sidebar visible (it was
  // already visible by default here, but we assert the post-state).
  await expect(page.getByText("Sign in to Remarks")).toBeVisible();
});
