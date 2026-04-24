import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeAutoScrollDelta, initPickerController } from "./picker-controller";
import { pickerStore } from "./picker-store";
import { byId, q } from "./test-utils";

function resetStore() {
  pickerStore.setState({
    mode: "idle",
    hovered: null,
    capture: null,
  });
}

function setScroll(x: number, y: number) {
  Object.defineProperty(window, "scrollX", { configurable: true, value: x });
  Object.defineProperty(window, "scrollY", { configurable: true, value: y });
}

// Track every controller created during a test so teardown still runs even
// when an assertion throws — otherwise leaked window listeners and subscribe
// callbacks bleed into later tests.
const pendingTeardowns: Array<() => void> = [];

function setupController(opts: { sidebarRoot: Node | null }) {
  const handle = initPickerController(opts);
  pendingTeardowns.push(handle.teardown);
  return handle;
}

beforeEach(() => {
  // Polyfill rAF to run synchronously for deterministic tests.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  document.body.innerHTML = "";
  setScroll(0, 0);
  resetStore();
});

afterEach(() => {
  while (pendingTeardowns.length > 0) {
    const td = pendingTeardowns.pop();
    try {
      td?.();
    } catch {
      // best-effort cleanup
    }
  }
  document.body.innerHTML = "";
  setScroll(0, 0);
  resetStore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function press(key: string, init: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true, ...init }));
}

function mouse(type: "mousedown" | "mousemove" | "mouseup", clientX: number, clientY: number) {
  window.dispatchEvent(
    new MouseEvent(type, {
      clientX,
      clientY,
      button: 0,
      bubbles: true,
      cancelable: true,
    })
  );
}

describe("initPickerController — element mode", () => {
  it("enters element mode when C is pressed", () => {
    setupController({ sidebarRoot: null });
    press("c");
    expect(pickerStore.getState().mode).toBe("element");
  });

  it("ignores C when focus is on a text input", () => {
    document.body.innerHTML = '<input type="text" />';
    const input = q<HTMLInputElement>("input");
    input.focus();

    setupController({ sidebarRoot: null });
    press("c");
    expect(pickerStore.getState().mode).toBe("idle");
  });

  it("ignores C when a modifier key is held", () => {
    setupController({ sidebarRoot: null });
    press("c", { metaKey: true });
    expect(pickerStore.getState().mode).toBe("idle");
  });

  it("cancels on Escape", () => {
    setupController({ sidebarRoot: null });
    press("c");
    expect(pickerStore.getState().mode).toBe("element");
    press("Escape");
    expect(pickerStore.getState().mode).toBe("idle");
  });

  it("attaches the overlay body class only while active", () => {
    setupController({ sidebarRoot: null });
    expect(document.body.classList.contains("rmk-picker-active")).toBe(false);
    press("c");
    expect(document.body.classList.contains("rmk-picker-active")).toBe(true);
    press("Escape");
    expect(document.body.classList.contains("rmk-picker-active")).toBe(false);
  });

  it("commits a capture on click when hovering an element", () => {
    document.body.innerHTML = '<button id="go" class="primary">Go</button>';
    const btn = byId("go");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(btn);

    setupController({ sidebarRoot: null });
    press("c");

    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 10 }));
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    const state = pickerStore.getState();
    expect(state.mode).toBe("idle");
    expect(state.capture?.kind).toBe("element");
    if (state.capture?.kind === "element") {
      expect(state.capture.selector).toBe("#go");
      expect(state.capture.strategy).toBe("id");
      expect(state.capture.domContext.tagName).toBe("button");
    }
  });

  it("teardown removes listeners and overlay", () => {
    const { teardown } = setupController({ sidebarRoot: null });
    press("c");
    expect(document.getElementById("rmk-picker-overlay")).not.toBeNull();
    teardown();
    expect(document.getElementById("rmk-picker-overlay")).toBeNull();
    resetStore();
    press("c");
    expect(pickerStore.getState().mode).toBe("idle");
  });
});

describe("initPickerController — rect mode", () => {
  it("enters rect mode when R is pressed", () => {
    setupController({ sidebarRoot: null });
    press("r");
    expect(pickerStore.getState().mode).toBe("rect");
    expect(document.body.classList.contains("rmk-rect-active")).toBe(true);
    expect(document.getElementById("rmk-rect-overlay")).not.toBeNull();
  });

  it("ignores R when focus is on a text input", () => {
    document.body.innerHTML = '<input type="text" />';
    q<HTMLInputElement>("input").focus();

    setupController({ sidebarRoot: null });
    press("r");
    expect(pickerStore.getState().mode).toBe("idle");
  });

  it("ignores R when a modifier key is held", () => {
    setupController({ sidebarRoot: null });
    press("r", { ctrlKey: true });
    expect(pickerStore.getState().mode).toBe("idle");
  });

  it("Escape cancels rect mode", () => {
    setupController({ sidebarRoot: null });
    press("r");
    expect(pickerStore.getState().mode).toBe("rect");
    press("Escape");
    expect(pickerStore.getState().mode).toBe("idle");
    expect(document.body.classList.contains("rmk-rect-active")).toBe(false);
    expect(document.getElementById("rmk-rect-overlay")).toBeNull();
  });

  it("commits a rect capture on a successful drag", () => {
    setupController({ sidebarRoot: null });
    press("r");
    mouse("mousedown", 100, 200);
    mouse("mousemove", 300, 350);
    mouse("mouseup", 300, 350);

    const state = pickerStore.getState();
    expect(state.mode).toBe("idle");
    expect(state.capture?.kind).toBe("rect");
    if (state.capture?.kind === "rect") {
      expect(state.capture.rect).toEqual({ x: 100, y: 200, width: 200, height: 150 });
      expect(state.capture.url).toBe(window.location.href);
    }
  });

  it("normalizes a drag that goes up-and-left into positive width/height", () => {
    setupController({ sidebarRoot: null });
    press("r");
    mouse("mousedown", 400, 400);
    mouse("mousemove", 100, 100);
    mouse("mouseup", 100, 100);

    const state = pickerStore.getState();
    expect(state.capture?.kind).toBe("rect");
    if (state.capture?.kind === "rect") {
      expect(state.capture.rect).toEqual({ x: 100, y: 100, width: 300, height: 300 });
    }
  });

  it("cancels a sub-threshold drag without committing", () => {
    setupController({ sidebarRoot: null });
    press("r");
    mouse("mousedown", 100, 100);
    mouse("mousemove", 103, 103);
    mouse("mouseup", 103, 103);

    expect(pickerStore.getState().capture).toBeNull();
    expect(pickerStore.getState().mode).toBe("idle");
  });

  it("stores rect coordinates in document space when scrolled mid-drag", () => {
    setupController({ sidebarRoot: null });
    press("r");
    setScroll(0, 500);
    mouse("mousedown", 100, 100);
    setScroll(0, 800);
    mouse("mousemove", 250, 200);
    mouse("mouseup", 250, 200);

    const state = pickerStore.getState();
    expect(state.capture?.kind).toBe("rect");
    if (state.capture?.kind === "rect") {
      // start: (100 + 0, 100 + 500) → doc (100, 600)
      // end:   (250 + 0, 200 + 800) → doc (250, 1000)
      // width spans the doc-coord delta, not the viewport delta.
      expect(state.capture.rect.x).toBe(100);
      expect(state.capture.rect.y).toBe(600);
      expect(state.capture.rect.width).toBe(150);
      expect(state.capture.rect.height).toBe(400);
    }
  });

  it("right-click cancels mid-drag", () => {
    setupController({ sidebarRoot: null });
    press("r");
    mouse("mousedown", 100, 100);
    mouse("mousemove", 200, 200);
    window.dispatchEvent(new MouseEvent("contextmenu", { cancelable: true, bubbles: true }));

    expect(pickerStore.getState().mode).toBe("idle");
    expect(pickerStore.getState().capture).toBeNull();
  });

  it("ignores mousedown originating inside the sidebar host element", () => {
    // jsdom's composedPath does not always include the ShadowRoot itself;
    // the picker-guard's host fallback (path.includes(sidebarRoot.host))
    // is what fires in production for clicks bubbled out of the shadow.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });

    setupController({ sidebarRoot: shadow });
    press("r");

    host.dispatchEvent(
      new MouseEvent("mousedown", {
        clientX: 50,
        clientY: 50,
        button: 0,
        bubbles: true,
        cancelable: true,
        composed: true,
      })
    );
    mouse("mousemove", 200, 200);
    mouse("mouseup", 200, 200);

    expect(pickerStore.getState().capture).toBeNull();
  });

  it("R while in element mode switches to rect (single overlay only)", () => {
    setupController({ sidebarRoot: null });
    press("c");
    expect(pickerStore.getState().mode).toBe("element");
    expect(document.getElementById("rmk-picker-overlay")).not.toBeNull();
    press("r");
    expect(pickerStore.getState().mode).toBe("rect");
    expect(document.getElementById("rmk-picker-overlay")).toBeNull();
    expect(document.getElementById("rmk-rect-overlay")).not.toBeNull();
  });

  it("teardown removes rect overlay and body class", () => {
    const { teardown } = setupController({ sidebarRoot: null });
    press("r");
    expect(document.getElementById("rmk-rect-overlay")).not.toBeNull();
    teardown();
    expect(document.getElementById("rmk-rect-overlay")).toBeNull();
    expect(document.body.classList.contains("rmk-rect-active")).toBe(false);
  });
});

describe("computeAutoScrollDelta", () => {
  it("returns 0 in the safe band", () => {
    expect(computeAutoScrollDelta(400, 800)).toBe(0);
  });

  it("returns a negative delta near the top edge", () => {
    expect(computeAutoScrollDelta(10, 800)).toBeLessThan(0);
  });

  it("returns a positive delta near the bottom edge", () => {
    expect(computeAutoScrollDelta(795, 800)).toBeGreaterThan(0);
  });

  it("scales intensity with proximity to the edge", () => {
    const closer = Math.abs(computeAutoScrollDelta(5, 800));
    const farther = Math.abs(computeAutoScrollDelta(35, 800));
    expect(closer).toBeGreaterThan(farther);
  });
});
