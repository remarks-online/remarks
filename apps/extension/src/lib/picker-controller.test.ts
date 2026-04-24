import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initPickerController } from "./picker-controller";
import { pickerStore } from "./picker-store";
import { byId, q } from "./test-utils";

function resetStore() {
  pickerStore.setState({
    mode: "idle",
    hovered: null,
    capture: null,
  });
}

beforeEach(() => {
  // Polyfill rAF to run synchronously for deterministic tests.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  document.body.innerHTML = "";
  resetStore();
});

afterEach(() => {
  document.body.innerHTML = "";
  resetStore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function press(key: string, init: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true, ...init }));
}

describe("initPickerController", () => {
  it("enters element mode when C is pressed", () => {
    const { teardown } = initPickerController({ sidebarRoot: null });
    press("c");
    expect(pickerStore.getState().mode).toBe("element");
    teardown();
  });

  it("ignores C when focus is on a text input", () => {
    document.body.innerHTML = '<input type="text" />';
    const input = q<HTMLInputElement>("input");
    input.focus();

    const { teardown } = initPickerController({ sidebarRoot: null });
    press("c");
    expect(pickerStore.getState().mode).toBe("idle");
    teardown();
  });

  it("ignores C when a modifier key is held", () => {
    const { teardown } = initPickerController({ sidebarRoot: null });
    press("c", { metaKey: true });
    expect(pickerStore.getState().mode).toBe("idle");
    teardown();
  });

  it("cancels on Escape", () => {
    const { teardown } = initPickerController({ sidebarRoot: null });
    press("c");
    expect(pickerStore.getState().mode).toBe("element");
    press("Escape");
    expect(pickerStore.getState().mode).toBe("idle");
    teardown();
  });

  it("attaches the overlay body class only while active", () => {
    const { teardown } = initPickerController({ sidebarRoot: null });
    expect(document.body.classList.contains("rmk-picker-active")).toBe(false);
    press("c");
    expect(document.body.classList.contains("rmk-picker-active")).toBe(true);
    press("Escape");
    expect(document.body.classList.contains("rmk-picker-active")).toBe(false);
    teardown();
  });

  it("commits a capture on click when hovering an element", () => {
    document.body.innerHTML = '<button id="go" class="primary">Go</button>';
    const btn = byId("go");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(btn);

    const { teardown } = initPickerController({ sidebarRoot: null });
    press("c");

    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 10 }));
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    const state = pickerStore.getState();
    expect(state.mode).toBe("idle");
    expect(state.capture?.selector).toBe("#go");
    expect(state.capture?.strategy).toBe("id");
    expect(state.capture?.domContext.tagName).toBe("button");
    teardown();
  });

  it("teardown removes listeners and overlay", () => {
    const { teardown } = initPickerController({ sidebarRoot: null });
    press("c");
    expect(document.getElementById("rmk-picker-overlay")).not.toBeNull();
    teardown();
    expect(document.getElementById("rmk-picker-overlay")).toBeNull();
    resetStore();
    press("c");
    expect(pickerStore.getState().mode).toBe("idle");
  });
});
