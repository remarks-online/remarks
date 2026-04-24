import type { Capture, ElementCapture, RectCapture } from "./picker-store";

// 1×1 transparent PNG. Kept in sync with lib/upload-annotation.test.ts.
export const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
export const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

export function makeElementCapture(overrides: Partial<ElementCapture> = {}): ElementCapture {
  return {
    kind: "element",
    url: "https://app.example.com/checkout",
    viewport: { width: 1920, height: 1080, dpr: 2 },
    scroll: { x: 0, y: 0 },
    capturedAt: 1_700_000_000_000,
    screenshot: { dataUrl: PNG_DATA_URL, width: 10, height: 10 },
    selector: "main > button.submit",
    strategy: "class",
    domContext: {
      tagName: "BUTTON",
      classes: ["submit"],
      textContent: "Place order",
    },
    targetCoords: { x: 100, y: 200, width: 80, height: 40 },
    ...overrides,
  };
}

export function makeRectCapture(overrides: Partial<RectCapture> = {}): RectCapture {
  return {
    kind: "rect",
    url: "https://app.example.com/checkout",
    viewport: { width: 1280, height: 720, dpr: 1 },
    scroll: { x: 0, y: 0 },
    capturedAt: 1_700_000_000_000,
    screenshot: { dataUrl: PNG_DATA_URL, width: 10, height: 10 },
    rect: { x: 50, y: 60, width: 200, height: 150 },
    ...overrides,
  };
}

export function makeCapture(): Capture {
  return makeElementCapture();
}
