import { expect, test } from "./fixtures";

const HOST_HTML = `<!doctype html><html><head><style>
  @keyframes rmk-spin { to { transform: rotate(360deg); } }
  #target { width: 80px; height: 80px; background: #f06; animation: rmk-spin 2s linear infinite; }
</style></head><body><h1>host</h1><div id="target"></div></body></html>`;

test("Pause animations toggle freezes host-page animations", async ({ extensionContext }) => {
  const page = await extensionContext.context.newPage();

  // Same fake-host trick as sidebar-injection.spec.ts: <all_urls> permission
  // means the content script gets injected even on routed pages. Auth state
  // doesn't matter — the freeze toggle lives in the More menu inside
  // SidebarHeader, which renders before the auth-gated body.
  await page.route("**/*", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/html", body: HOST_HTML });
  });
  await page.goto("http://remarks.test/");
  await page.waitForLoadState("load");

  await expect(page.locator("remarks-sidebar")).toBeAttached({ timeout: 15_000 });

  // Sanity: target element animation is running before we toggle.
  const initialPlayState = await page
    .locator("#target")
    .evaluate((el) => getComputedStyle(el).animationPlayState);
  expect(initialPlayState).toBe("running");

  // Open More menu (Radix portals into the sidebar's shadow root, but
  // Playwright's text/role engines pierce open shadow roots). The button has
  // aria-label="More options" per SidebarMoreMenu.tsx.
  await page.getByRole("button", { name: "More options" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Pause animations" }).click();

  // Style tag is injected directly into the host document's <head>, so it's
  // visible to a host-document selector (not piercing the shadow root).
  await expect(page.locator("#rmk-animation-freeze")).toBeAttached();
  const pausedState = await page
    .locator("#target")
    .evaluate((el) => getComputedStyle(el).animationPlayState);
  expect(pausedState).toBe("paused");

  // Toggle off — style removed and animation back to running.
  await page.getByRole("button", { name: "More options" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Pause animations" }).click();
  await expect(page.locator("#rmk-animation-freeze")).toHaveCount(0);
  const resumedState = await page
    .locator("#target")
    .evaluate((el) => getComputedStyle(el).animationPlayState);
  expect(resumedState).toBe("running");
});
