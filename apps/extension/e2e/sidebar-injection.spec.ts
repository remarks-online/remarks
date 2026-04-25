import { expect, test } from "./fixtures";

test("content script injects the sidebar shadow root into host pages", async ({
  extensionContext,
}) => {
  const page = await extensionContext.context.newPage();

  // Use a fake http URL fulfilled by page.route. <all_urls> host permission
  // means the content script gets injected; data: URLs are skipped by content
  // scripts so we can't use page.setContent here. Same trick as
  // verify/screenshot-preview.spec.ts:57-61.
  await page.route("**/*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body><h1>host</h1></body></html>",
    });
  });
  await page.goto("http://remarks.test/");
  await page.waitForLoadState("load");

  // WXT mounts the shadow host as <remarks-sidebar> per the `name` passed to
  // createShadowRootUi (apps/extension/src/entrypoints/content.tsx:20).
  const shadowHost = page.locator("remarks-sidebar");
  await expect(shadowHost).toBeAttached({ timeout: 15_000 });

  // Default sidebar visible state is true (SIDEBAR_DEFAULTS in sidebar-store.ts);
  // with no Clerk session the shell renders <SidebarSignedOut /> whose CardTitle
  // is "Sign in to Remarks" (SidebarSignedOut.tsx:13). Playwright's text engine
  // pierces open shadow roots — WXT's createShadowRootUi defaults to open mode.
  await expect(page.getByText("Sign in to Remarks")).toBeVisible({ timeout: 15_000 });
});
