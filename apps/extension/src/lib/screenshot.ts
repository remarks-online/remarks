import { isContextInvalidatedError } from "@/lib/extension-context";
import { type Capture, type CaptureScreenshot, pickerStore } from "@/lib/picker-store";
import type { BackgroundRequest, BackgroundResponse, ViewportRect } from "@/types";

export interface RequestScreenshotOptions {
  // G17: when supplied, screenshot results land via this callback instead of
  // `pickerStore.setScreenshot`. The picker controller passes it for
  // multi-select appends so each capture in `pendingSelections` gets its own
  // screenshot keyed to its index.
  onResult?: (screenshot: CaptureScreenshot | null) => void;
}

/**
 * Ask the background service worker to take a `chrome.tabs.captureVisibleTab`
 * screenshot, crop it to the picked element/rect, and hand back a base64 data
 * URL. The result is merged onto the current capture in `pickerStore` so the
 * sidebar preview re-renders when it arrives. Fire-and-forget from the caller.
 *
 * Doc coords stay in the store (they need to survive scroll). Translation to
 * viewport coords happens here, at the moment of capture, so a scroll between
 * commit and screenshot doesn't corrupt the crop.
 */
export async function requestScreenshot(
  capture: Capture,
  options: RequestScreenshotOptions = {}
): Promise<void> {
  const apply = (screenshot: CaptureScreenshot | null): void => {
    if (options.onResult) options.onResult(screenshot);
    else pickerStore.getState().setScreenshot(screenshot);
  };

  const viewportRect = clampToViewport(rectFor(capture), capture.viewport);
  if (!viewportRect) {
    // Off-screen / zero-area — nothing to capture.
    apply(null);
    return;
  }

  // In jsdom (unit tests) `chrome` is undefined — skip quietly instead of
  // routing a ReferenceError through the catch just to log a noisy warning.
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;

  const request: BackgroundRequest = {
    kind: "capture-screenshot",
    viewportRect,
    dpr: capture.viewport.dpr,
  };

  try {
    const response = (await chrome.runtime.sendMessage(request)) as BackgroundResponse;
    if (!response.ok) {
      console.warn("[remarks] screenshot request failed:", response.error);
      apply(null);
      return;
    }
    if (response.kind !== "capture-screenshot") {
      apply(null);
      return;
    }
    apply({
      dataUrl: response.dataUrl,
      width: response.width,
      height: response.height,
    });
  } catch (err) {
    if (isContextInvalidatedError(err)) {
      console.debug("[remarks] screenshot skipped: extension context invalidated");
    } else {
      console.warn("[remarks] screenshot message failed:", err);
    }
    apply(null);
  }
}

function rectFor(capture: Capture): ViewportRect {
  const doc = capture.kind === "element" ? capture.targetCoords : capture.rect;
  return {
    x: doc.x - capture.scroll.x,
    y: doc.y - capture.scroll.y,
    width: doc.width,
    height: doc.height,
  };
}

function clampToViewport(
  rect: ViewportRect,
  viewport: { width: number; height: number }
): ViewportRect | null {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const right = Math.min(viewport.width, rect.x + rect.width);
  const bottom = Math.min(viewport.height, rect.y + rect.height);
  const width = right - x;
  const height = bottom - y;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}
