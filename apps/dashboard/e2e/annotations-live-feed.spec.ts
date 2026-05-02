import { TEST_PROJECT_SLUG } from "./constants.js";
import { expect, test } from "./fixtures.js";

// D1: the annotations browser opens an SSE stream for live updates.
// This spec verifies the wiring (auth-headered fetch reaches G9, the
// connection opens, the LiveIndicator transitions to "Live"). Actual
// push-delivery behavior is exercised by API integration tests for G9.
test("annotations browser opens an SSE stream and shows the Live indicator", async ({
  signedInPage,
}) => {
  const sseRequests: Array<{ url: string; hasAuth: boolean }> = [];
  signedInPage.on("request", (req) => {
    const url = req.url();
    if (req.method() === "GET" && url.includes("/projects/") && url.endsWith("/events")) {
      sseRequests.push({
        url,
        hasAuth: Boolean(req.headers().authorization),
      });
    }
  });

  await signedInPage.goto(`/app/projects/${TEST_PROJECT_SLUG}`);
  await expect(signedInPage.getByText("No annotations yet")).toBeVisible();

  // Indicator transitions from "Connecting…" → "Live" once the SSE handshake
  // completes (auth, project membership, bus subscribe, replay drain).
  await expect(signedInPage.getByText("Live")).toBeVisible({ timeout: 10_000 });

  expect(sseRequests.length).toBeGreaterThan(0);
  const first = sseRequests[0];
  expect(first?.url).toMatch(/\/projects\/[0-9a-f-]{36}\/events$/);
  expect(first?.hasAuth).toBe(true);
});
