import path from "node:path";
import { fileURLToPath } from "node:url";
import { type BrowserContext, chromium, expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_PATH = path.resolve(__dirname, "..", ".output", "chrome-mv3");
const USER_DATA_DIR = path.resolve(__dirname, ".user-data-screenshot");
const EXT_ID = "baikikfefeheiildmfoaicbjbnbecgjd";

// Task 1.26 — verify the background service worker's captureScreenshot handler
// cuts a valid PNG out of the visible tab. Exercises the SW path only:
// chrome.tabs.captureVisibleTab + createImageBitmap crop + OffscreenCanvas
// → base64 PNG. The sidebar <img> preview is covered by unit behaviour +
// manual smoke per docs/plan/remarks-phase-0-1-spec.md §14 task 1.26; a full
// sidebar UI assertion requires a signed-in project-selected session which
// the auth-flow spec already covers end-to-end.
test("background captureScreenshot returns a cropped PNG data URL for the visible tab", async () => {
  const context: BrowserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
  });

  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15_000 });
    expect(sw.url()).toContain(EXT_ID);
    const swErrors: string[] = [];
    sw.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        console.log(`[sw error] ${text}`);
        swErrors.push(text);
      }
    });

    // Open a known page with a solid-color target rect so we can assert the
    // cropped PNG's width/height instead of fiddling with pixel sampling.
    // Use a fake http URL + page.route so <all_urls> host permission applies
    // (captureVisibleTab rejects data: URLs with "activeTab not invoked").
    const html = `
      <!doctype html>
      <html><head><style>
        body { margin: 0; padding: 0; background: white; }
        #target {
          position: absolute;
          left: 200px;
          top: 150px;
          width: 320px;
          height: 180px;
          background: #4f46e5;
        }
      </style></head>
      <body><div id="target"></div></body></html>
    `;
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route("**/*", async (route) => {
      await route.fulfill({ status: 200, contentType: "text/html", body: html });
    });
    await page.goto("http://remarks.test/verify/screenshot");
    await page.waitForLoadState("load");

    const activeTab = await sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return tabs[0]?.id ?? null;
    });
    expect(activeTab).not.toBeNull();

    const response = (await sw.evaluate(
      async ({ tabId, viewportRect, dpr }) => {
        const fn = (
          globalThis as unknown as {
            __remarksCaptureScreenshot?: (
              tabId: number,
              viewportRect: { x: number; y: number; width: number; height: number },
              dpr: number
            ) => Promise<unknown>;
          }
        ).__remarksCaptureScreenshot;
        if (typeof fn !== "function") return { error: "__remarksCaptureScreenshot not exposed" };
        try {
          return await fn(tabId, viewportRect, dpr);
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
      {
        tabId: activeTab as number,
        viewportRect: { x: 200, y: 150, width: 320, height: 180 },
        dpr: 1,
      }
    )) as { dataUrl?: string; width?: number; height?: number; error?: string };

    expect(response.error).toBeUndefined();
    expect(response.dataUrl).toBeTruthy();
    expect(response.dataUrl?.startsWith("data:image/png;base64,")).toBe(true);
    expect(response.width).toBe(320);
    expect(response.height).toBe(180);

    // Sanity-check the payload decodes to a PNG (magic bytes 89 50 4E 47).
    const dataUrl = response.dataUrl as string;
    const base64 = dataUrl.slice("data:image/png;base64,".length);
    const bytes = Buffer.from(base64, "base64");
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x4e);
    expect(bytes[3]).toBe(0x47);

    if (swErrors.length > 0) {
      throw new Error(`service worker logged errors:\n${swErrors.join("\n")}`);
    }
  } finally {
    await context.close();
  }
});
