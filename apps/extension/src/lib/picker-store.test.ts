import { describe, expect, it } from "vitest";
import { type ElementCapture, pickerStore } from "./picker-store";

function makeElementCapture(overrides: Partial<ElementCapture> = {}): ElementCapture {
  return {
    kind: "element",
    selector: "#hero",
    strategy: "id",
    domContext: { tagName: "div" },
    url: "https://example.test/page",
    viewport: { width: 1280, height: 720, dpr: 1 },
    scroll: { x: 0, y: 0 },
    targetCoords: { x: 0, y: 0, width: 100, height: 40 },
    capturedAt: 0,
    ...overrides,
  };
}

function reset() {
  pickerStore.setState({
    mode: "idle",
    hovered: null,
    capture: null,
    popoverDismissed: false,
    multiSelectMode: false,
    pendingSelections: [],
  });
}

describe("pickerStore — multi-select (G17)", () => {
  it("appendSelection pushes to pendingSelections in order", () => {
    reset();
    const a = makeElementCapture({ selector: "#a" });
    const b = makeElementCapture({ selector: "#b" });
    pickerStore.getState().appendSelection(a);
    pickerStore.getState().appendSelection(b);
    expect(pickerStore.getState().pendingSelections.map((c) => c.selector)).toEqual(["#a", "#b"]);
  });

  it("removeSelection drops the requested index", () => {
    reset();
    pickerStore.getState().appendSelection(makeElementCapture({ selector: "#a" }));
    pickerStore.getState().appendSelection(makeElementCapture({ selector: "#b" }));
    pickerStore.getState().appendSelection(makeElementCapture({ selector: "#c" }));
    pickerStore.getState().removeSelection(1);
    expect(pickerStore.getState().pendingSelections.map((c) => c.selector)).toEqual(["#a", "#c"]);
  });

  it("clearSelections empties the array", () => {
    reset();
    pickerStore.getState().appendSelection(makeElementCapture());
    pickerStore.getState().appendSelection(makeElementCapture({ selector: "#b" }));
    pickerStore.getState().clearSelections();
    expect(pickerStore.getState().pendingSelections).toHaveLength(0);
  });

  it("setScreenshotForPending writes onto the indexed entry only", () => {
    reset();
    pickerStore.getState().appendSelection(makeElementCapture({ selector: "#a" }));
    pickerStore.getState().appendSelection(makeElementCapture({ selector: "#b" }));
    pickerStore
      .getState()
      .setScreenshotForPending(1, { dataUrl: "data:image/png;base64,xx", width: 10, height: 5 });
    const list = pickerStore.getState().pendingSelections;
    expect(list[0]?.screenshot).toBeUndefined();
    expect(list[1]?.screenshot).toEqual({
      dataUrl: "data:image/png;base64,xx",
      width: 10,
      height: 5,
    });
  });

  it("setScreenshotForPending(null) clears just the indexed entry's screenshot", () => {
    reset();
    pickerStore.getState().appendSelection(
      makeElementCapture({
        selector: "#a",
        screenshot: { dataUrl: "data:,", width: 1, height: 1 },
      })
    );
    pickerStore.getState().setScreenshotForPending(0, null);
    expect(pickerStore.getState().pendingSelections[0]?.screenshot).toBeUndefined();
  });

  it("setScreenshotForPending is a no-op when index is out of bounds", () => {
    reset();
    pickerStore.getState().appendSelection(makeElementCapture());
    const before = pickerStore.getState().pendingSelections;
    pickerStore.getState().setScreenshotForPending(5, { dataUrl: "data:,", width: 1, height: 1 });
    expect(pickerStore.getState().pendingSelections).toBe(before);
  });

  it("setMultiSelectMode(false) drops any partially-built batch", () => {
    reset();
    pickerStore.getState().setMultiSelectMode(true);
    pickerStore.getState().appendSelection(makeElementCapture());
    expect(pickerStore.getState().pendingSelections).toHaveLength(1);
    pickerStore.getState().setMultiSelectMode(false);
    expect(pickerStore.getState().pendingSelections).toHaveLength(0);
    expect(pickerStore.getState().multiSelectMode).toBe(false);
  });

  it("commitGroup keeps pendingSelections and sets capture to the anchor", () => {
    reset();
    const a = makeElementCapture({ selector: "#a" });
    const b = makeElementCapture({ selector: "#b" });
    pickerStore.getState().appendSelection(a);
    pickerStore.getState().appendSelection(b);
    pickerStore.getState().commitGroup(b);
    const state = pickerStore.getState();
    expect(state.mode).toBe("idle");
    expect(state.pendingSelections).toHaveLength(2);
    if (state.capture?.kind === "element") expect(state.capture.selector).toBe("#b");
    expect(state.multiSelectMode).toBe(false);
  });

  it("clearCapture resets pendingSelections + multi mode", () => {
    reset();
    pickerStore.getState().setMultiSelectMode(true);
    pickerStore.getState().appendSelection(makeElementCapture());
    pickerStore.getState().clearCapture();
    expect(pickerStore.getState().pendingSelections).toHaveLength(0);
    expect(pickerStore.getState().multiSelectMode).toBe(false);
  });

  it("entering element mode clears any leftover multi state", () => {
    reset();
    pickerStore.getState().setMultiSelectMode(true);
    pickerStore.getState().appendSelection(makeElementCapture());
    pickerStore.getState().enterElementMode();
    expect(pickerStore.getState().multiSelectMode).toBe(false);
    expect(pickerStore.getState().pendingSelections).toHaveLength(0);
  });
});
