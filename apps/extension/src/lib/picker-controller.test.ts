import type { ReactComponentNode } from "@remarks/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickerStore } from "./picker-store";
import { sidebarStore } from "./sidebar-store";
import { byId, q } from "./test-utils";

// Mock the fiber bridge so tests can deterministically control React enrichment
// without spinning up a MAIN-world content script. Default is a no-op (resolves
// null) so existing tests that don't care about React stay green; G17 cases
// override per-call.
const requestReactComponentsMock = vi.fn(
  async (
    _el: Element
  ): Promise<{
    components: ReactComponentNode[];
    frameworkDetected: boolean;
  } | null> => null
);
vi.mock("./fiber-bridge", () => ({
  requestReactComponents: (el: Element) => requestReactComponentsMock(el),
}));

const { computeAutoScrollDelta, initPickerController } = await import("./picker-controller");

function resetStore() {
  pickerStore.setState({
    mode: "idle",
    hovered: null,
    capture: null,
    popoverDismissed: false,
    multiSelectMode: false,
    pendingSelections: [],
  });
}

function pressElement(init: KeyboardEventInit = {}) {
  press("E", { code: "KeyE", metaKey: true, shiftKey: true, ...init });
}

function pressRect(init: KeyboardEventInit = {}) {
  press("X", { code: "KeyX", metaKey: true, shiftKey: true, ...init });
}

function setScroll(x: number, y: number) {
  Object.defineProperty(window, "scrollX", { configurable: true, value: x });
  Object.defineProperty(window, "scrollY", { configurable: true, value: y });
}

// Track every controller created during a test so teardown still runs even
// when an assertion throws — otherwise leaked window listeners and subscribe
// callbacks bleed into later tests.
const pendingTeardowns: Array<() => void> = [];

function setupController(opts: {
  sidebarRoot: Node | null;
  isSignedIn?: () => boolean;
  onActivateBlocked?: () => void;
}) {
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
  sidebarStore.getState().reset();
  // Default: bridge resolves null (no React detected). Per-test cases override.
  requestReactComponentsMock.mockReset();
  requestReactComponentsMock.mockResolvedValue(null);
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
  sidebarStore.getState().reset();
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
  it("enters element mode when ⌘⇧E is pressed", () => {
    setupController({ sidebarRoot: null });
    pressElement();
    expect(pickerStore.getState().mode).toBe("element");
  });

  it("also accepts Ctrl+Shift+E", () => {
    setupController({ sidebarRoot: null });
    pressElement({ metaKey: false, ctrlKey: true });
    expect(pickerStore.getState().mode).toBe("element");
  });

  it("ignores bare 'e' (no modifiers)", () => {
    setupController({ sidebarRoot: null });
    press("e");
    expect(pickerStore.getState().mode).toBe("idle");
  });

  it("ignores ⌘⇧E when focus is on a text input", () => {
    document.body.innerHTML = '<input type="text" />';
    const input = q<HTMLInputElement>("input");
    input.focus();

    setupController({ sidebarRoot: null });
    pressElement();
    expect(pickerStore.getState().mode).toBe("idle");
  });

  it("ignores ⌘⇧E when typing in a textarea inside a shadow root", () => {
    // Regression for the original bug: window-level keydowns from inside a
    // shadow root retarget — `document.activeElement` is the shadow host, but
    // `event.composedPath()[0]` is the actual textarea. The guard must use the
    // composedPath-derived target, not activeElement.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const textarea = document.createElement("textarea");
    shadow.appendChild(textarea);

    setupController({ sidebarRoot: null });
    const ev = new KeyboardEvent("keydown", {
      key: "E",
      code: "KeyE",
      metaKey: true,
      shiftKey: true,
      cancelable: true,
      bubbles: true,
      composed: true,
    });
    textarea.dispatchEvent(ev);
    expect(pickerStore.getState().mode).toBe("idle");
  });

  it("ignores ⌘⇧E when Alt is also held", () => {
    setupController({ sidebarRoot: null });
    pressElement({ altKey: true });
    expect(pickerStore.getState().mode).toBe("idle");
  });

  it("cancels on Escape", () => {
    setupController({ sidebarRoot: null });
    pressElement();
    expect(pickerStore.getState().mode).toBe("element");
    press("Escape");
    expect(pickerStore.getState().mode).toBe("idle");
  });

  it("attaches the overlay body class only while active", () => {
    setupController({ sidebarRoot: null });
    expect(document.body.classList.contains("rmk-picker-active")).toBe(false);
    pressElement();
    expect(document.body.classList.contains("rmk-picker-active")).toBe(true);
    press("Escape");
    expect(document.body.classList.contains("rmk-picker-active")).toBe(false);
  });

  it("commits a capture on click when hovering an element", () => {
    document.body.innerHTML = '<button id="go" class="primary">Go</button>';
    const btn = byId("go");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(btn);

    setupController({ sidebarRoot: null });
    pressElement();

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
    pressElement();
    expect(document.getElementById("rmk-picker-overlay")).not.toBeNull();
    expect(document.getElementById("rmk-picker-styles")).not.toBeNull();
    teardown();
    expect(document.getElementById("rmk-picker-overlay")).toBeNull();
    expect(document.getElementById("rmk-picker-styles")).toBeNull();
    resetStore();
    pressElement();
    expect(pickerStore.getState().mode).toBe("idle");
  });

  describe("hover-styles tooltip", () => {
    it("creates the tooltip node when entering element mode", () => {
      setupController({ sidebarRoot: null });
      pressElement();
      const tooltip = document.getElementById("rmk-picker-styles");
      expect(tooltip).not.toBeNull();
      // Hidden by default since the pref defaults to off.
      expect(tooltip?.style.transform).toBe("translate(-9999px, -9999px)");
    });

    it("stays hidden while hovering when the pref is off", () => {
      document.body.innerHTML =
        '<button id="go" style="color: rgb(255, 0, 0); padding: 8px;">Go</button>';
      const btn = byId("go");
      vi.spyOn(document, "elementFromPoint").mockReturnValue(btn);

      setupController({ sidebarRoot: null });
      pressElement();
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 10 }));

      const tooltip = document.getElementById("rmk-picker-styles");
      expect(tooltip?.style.transform).toBe("translate(-9999px, -9999px)");
      expect(tooltip?.textContent ?? "").toBe("");
    });

    it("renders rows and positions the tooltip when the pref is on", () => {
      document.body.innerHTML =
        '<button id="go" style="color: rgb(255, 0, 0); padding: 8px; font-family: Helvetica;">Go</button>';
      const btn = byId("go");
      vi.spyOn(document, "elementFromPoint").mockReturnValue(btn);

      sidebarStore.getState().setShowHoverStyles(true);
      setupController({ sidebarRoot: null });
      pressElement();
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 10 }));

      const tooltip = document.getElementById("rmk-picker-styles");
      expect(tooltip).not.toBeNull();
      expect(tooltip?.style.transform).not.toBe("translate(-9999px, -9999px)");
      // dl + dt + dd structure.
      expect(tooltip?.querySelector("dl")).not.toBeNull();
      const labels = Array.from(tooltip?.querySelectorAll("dt") ?? []).map((n) => n.textContent);
      expect(labels).toContain("color");
      expect(labels).toContain("padding");
      expect(labels).toContain("font-family");
    });

    it("hides the tooltip again when the cursor leaves into the sidebar root", () => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const sidebarRoot = host.attachShadow({ mode: "open" });
      const sidebarChild = document.createElement("div");
      sidebarRoot.appendChild(sidebarChild);

      document.body.innerHTML +=
        '<button id="go" style="color: rgb(255, 0, 0); padding: 8px;">Go</button>';
      const btn = byId("go");
      const elementFromPoint = vi.spyOn(document, "elementFromPoint");
      elementFromPoint.mockReturnValue(btn);

      sidebarStore.getState().setShowHoverStyles(true);
      setupController({ sidebarRoot });
      pressElement();
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 10 }));

      const tooltip = document.getElementById("rmk-picker-styles");
      expect(tooltip?.style.transform).not.toBe("translate(-9999px, -9999px)");

      // Now move into the sidebar — picker-controller resolves this via
      // composedPath, but isInSidebarUi also checks elementFromPoint as a
      // fallback. Re-target to a node inside the shadow root.
      elementFromPoint.mockReturnValue(sidebarChild);
      const ev = new MouseEvent("mousemove", { clientX: 10, clientY: 10, bubbles: true });
      Object.defineProperty(ev, "composedPath", {
        value: () => [sidebarChild, sidebarRoot, host, document.body],
      });
      window.dispatchEvent(ev);

      expect(tooltip?.style.transform).toBe("translate(-9999px, -9999px)");
    });
  });
});

describe("initPickerController — rect mode", () => {
  it("enters rect mode when ⌘⇧X is pressed", () => {
    setupController({ sidebarRoot: null });
    pressRect();
    expect(pickerStore.getState().mode).toBe("rect");
    expect(document.body.classList.contains("rmk-rect-active")).toBe(true);
    expect(document.getElementById("rmk-rect-overlay")).not.toBeNull();
  });

  it("also accepts Ctrl+Shift+X", () => {
    setupController({ sidebarRoot: null });
    pressRect({ metaKey: false, ctrlKey: true });
    expect(pickerStore.getState().mode).toBe("rect");
  });

  it("ignores bare 'x' (no modifiers)", () => {
    setupController({ sidebarRoot: null });
    press("x");
    expect(pickerStore.getState().mode).toBe("idle");
  });

  it("ignores ⌘⇧X when focus is on a text input", () => {
    document.body.innerHTML = '<input type="text" />';
    q<HTMLInputElement>("input").focus();

    setupController({ sidebarRoot: null });
    pressRect();
    expect(pickerStore.getState().mode).toBe("idle");
  });

  it("ignores ⌘⇧X when Alt is also held", () => {
    setupController({ sidebarRoot: null });
    pressRect({ altKey: true });
    expect(pickerStore.getState().mode).toBe("idle");
  });

  it("Escape cancels rect mode", () => {
    setupController({ sidebarRoot: null });
    pressRect();
    expect(pickerStore.getState().mode).toBe("rect");
    press("Escape");
    expect(pickerStore.getState().mode).toBe("idle");
    expect(document.body.classList.contains("rmk-rect-active")).toBe(false);
    expect(document.getElementById("rmk-rect-overlay")).toBeNull();
  });

  it("commits a rect capture on a successful drag", () => {
    setupController({ sidebarRoot: null });
    pressRect();
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
    pressRect();
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
    pressRect();
    mouse("mousedown", 100, 100);
    mouse("mousemove", 103, 103);
    mouse("mouseup", 103, 103);

    expect(pickerStore.getState().capture).toBeNull();
    expect(pickerStore.getState().mode).toBe("idle");
  });

  it("stores rect coordinates in document space when scrolled mid-drag", () => {
    setupController({ sidebarRoot: null });
    pressRect();
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
    pressRect();
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
    pressRect();

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

  it("⌘⇧X while in element mode switches to rect (single overlay only)", () => {
    setupController({ sidebarRoot: null });
    pressElement();
    expect(pickerStore.getState().mode).toBe("element");
    expect(document.getElementById("rmk-picker-overlay")).not.toBeNull();
    pressRect();
    expect(pickerStore.getState().mode).toBe("rect");
    expect(document.getElementById("rmk-picker-overlay")).toBeNull();
    expect(document.getElementById("rmk-rect-overlay")).not.toBeNull();
  });

  it("teardown removes rect overlay and body class", () => {
    const { teardown } = setupController({ sidebarRoot: null });
    pressRect();
    expect(document.getElementById("rmk-rect-overlay")).not.toBeNull();
    teardown();
    expect(document.getElementById("rmk-rect-overlay")).toBeNull();
    expect(document.body.classList.contains("rmk-rect-active")).toBe(false);
  });
});

describe("initPickerController — auth gate", () => {
  it("ignores ⌘⇧E and ⌘⇧X while signed out, and surfaces the sign-in CTA", () => {
    const onActivateBlocked = vi.fn();
    setupController({
      sidebarRoot: null,
      isSignedIn: () => false,
      onActivateBlocked,
    });

    pressElement();
    expect(pickerStore.getState().mode).toBe("idle");
    pressRect();
    expect(pickerStore.getState().mode).toBe("idle");

    expect(onActivateBlocked).toHaveBeenCalledTimes(2);
  });

  it("bounces direct pickerStore.enterElementMode calls back to idle while signed out", () => {
    const onActivateBlocked = vi.fn();
    setupController({
      sidebarRoot: null,
      isSignedIn: () => false,
      onActivateBlocked,
    });

    pickerStore.getState().enterElementMode();
    expect(pickerStore.getState().mode).toBe("idle");
    expect(onActivateBlocked).toHaveBeenCalledTimes(1);
  });

  it("bounces direct pickerStore.enterRectMode calls back to idle while signed out", () => {
    const onActivateBlocked = vi.fn();
    setupController({
      sidebarRoot: null,
      isSignedIn: () => false,
      onActivateBlocked,
    });

    pickerStore.getState().enterRectMode();
    expect(pickerStore.getState().mode).toBe("idle");
    expect(onActivateBlocked).toHaveBeenCalledTimes(1);
  });

  it("permits ⌘⇧E and ⌘⇧X when signed in", () => {
    const onActivateBlocked = vi.fn();
    setupController({
      sidebarRoot: null,
      isSignedIn: () => true,
      onActivateBlocked,
    });

    pressElement();
    expect(pickerStore.getState().mode).toBe("element");
    expect(onActivateBlocked).not.toHaveBeenCalled();
  });
});

describe("initPickerController — multi-select (G17)", () => {
  function clickElement(target: Element, init: MouseEventInit = {}) {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
  }

  // Tick the microtask queue so a Promise.resolve(...) chain (the await/then
  // in `void requestReactComponents(...).then(...)`) flushes before assertions.
  async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  it("Alt+click appends to pendingSelections without committing", () => {
    document.body.innerHTML = '<button id="a">A</button><button id="b">B</button>';
    const a = byId("a");
    const b = byId("b");
    vi.spyOn(document, "elementFromPoint").mockReturnValueOnce(a).mockReturnValueOnce(b);

    setupController({ sidebarRoot: null });
    pressElement();
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 5 }));
    clickElement(a, { altKey: true });

    let state = pickerStore.getState();
    expect(state.mode).toBe("element"); // session still active
    expect(state.capture).toBeNull();
    expect(state.pendingSelections).toHaveLength(1);
    expect(state.pendingSelections[0]?.selector).toBe("#a");

    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 50, clientY: 5 }));
    clickElement(b, { altKey: true });

    state = pickerStore.getState();
    expect(state.mode).toBe("element");
    expect(state.pendingSelections).toHaveLength(2);
    expect(state.pendingSelections.map((c) => c.selector)).toEqual(["#a", "#b"]);
  });

  it("plain click after pending selections commits the group", () => {
    document.body.innerHTML = '<button id="a">A</button><button id="b">B</button>';
    const a = byId("a");
    const b = byId("b");
    vi.spyOn(document, "elementFromPoint").mockReturnValueOnce(a).mockReturnValueOnce(b);

    setupController({ sidebarRoot: null });
    pressElement();
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 5 }));
    clickElement(a, { altKey: true });
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 50, clientY: 5 }));
    clickElement(b);

    const state = pickerStore.getState();
    expect(state.mode).toBe("idle");
    // Both elements end up in pendingSelections (popover renders the stack).
    expect(state.pendingSelections).toHaveLength(2);
    // The popover anchor is the last-clicked element.
    if (state.capture?.kind === "element") {
      expect(state.capture.selector).toBe("#b");
    }
  });

  it("multiSelectMode toggle treats plain click as append", () => {
    document.body.innerHTML = '<button id="a">A</button>';
    const a = byId("a");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(a);

    setupController({ sidebarRoot: null });
    pressElement();
    pickerStore.getState().setMultiSelectMode(true);

    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 5 }));
    clickElement(a); // plain click, no Alt — append because toggle is on
    expect(pickerStore.getState().pendingSelections).toHaveLength(1);
    expect(pickerStore.getState().mode).toBe("element");
  });

  it("Backspace pops the last pending selection", () => {
    document.body.innerHTML = '<button id="a">A</button><button id="b">B</button>';
    const a = byId("a");
    const b = byId("b");
    vi.spyOn(document, "elementFromPoint").mockReturnValueOnce(a).mockReturnValueOnce(b);

    setupController({ sidebarRoot: null });
    pressElement();
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 5 }));
    clickElement(a, { altKey: true });
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 50, clientY: 5 }));
    clickElement(b, { altKey: true });
    expect(pickerStore.getState().pendingSelections).toHaveLength(2);

    press("Backspace");
    expect(pickerStore.getState().pendingSelections).toHaveLength(1);
    expect(pickerStore.getState().pendingSelections[0]?.selector).toBe("#a");
  });

  it("Enter commits the group with the last pending entry as anchor", () => {
    document.body.innerHTML = '<button id="a">A</button>';
    const a = byId("a");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(a);

    setupController({ sidebarRoot: null });
    pressElement();
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 5 }));
    clickElement(a, { altKey: true });
    expect(pickerStore.getState().pendingSelections).toHaveLength(1);

    press("Enter");
    const state = pickerStore.getState();
    expect(state.mode).toBe("idle");
    expect(state.pendingSelections).toHaveLength(1);
    if (state.capture?.kind === "element") {
      expect(state.capture.selector).toBe("#a");
    }
  });

  it("Escape with pending selections clears them but keeps the session", () => {
    document.body.innerHTML = '<button id="a">A</button>';
    const a = byId("a");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(a);

    setupController({ sidebarRoot: null });
    pressElement();
    pickerStore.getState().setMultiSelectMode(true);
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 5 }));
    clickElement(a);
    expect(pickerStore.getState().pendingSelections).toHaveLength(1);

    press("Escape");
    const state = pickerStore.getState();
    expect(state.mode).toBe("element"); // session still alive
    expect(state.pendingSelections).toHaveLength(0);
    expect(state.multiSelectMode).toBe(false);
  });

  it("React enrichment lands on the just-appended slot, not the previous one", async () => {
    document.body.innerHTML = '<button id="a">A</button><button id="b">B</button>';
    const a = byId("a");
    const b = byId("b");
    vi.spyOn(document, "elementFromPoint").mockReturnValueOnce(a).mockReturnValueOnce(b);

    // First Alt+click: bridge resolves with #a's component chain.
    requestReactComponentsMock.mockResolvedValueOnce({
      components: [{ name: "ButtonA", kind: "function" }],
      frameworkDetected: true,
    });
    // Second Alt+click: bridge resolves with #b's chain.
    requestReactComponentsMock.mockResolvedValueOnce({
      components: [{ name: "ButtonB", kind: "function" }],
      frameworkDetected: true,
    });

    setupController({ sidebarRoot: null });
    pressElement();
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 5 }));
    clickElement(a, { altKey: true });
    await flushMicrotasks();
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 50, clientY: 5 }));
    clickElement(b, { altKey: true });
    await flushMicrotasks();

    const list = pickerStore.getState().pendingSelections;
    expect(list).toHaveLength(2);
    // The bug had #b's React result splice onto list[0] (#a's slot). After the
    // fix, #a's result lands on list[0] and #b's on list[1].
    expect(list[0]?.selector).toBe("#a");
    expect(list[0]?.domContext.reactComponents?.[0]?.name).toBe("ButtonA");
    expect(list[0]?.frameworkHint).toBe("react");
    expect(list[1]?.selector).toBe("#b");
    expect(list[1]?.domContext.reactComponents?.[0]?.name).toBe("ButtonB");
    expect(list[1]?.frameworkHint).toBe("react");
  });

  it("hides picker chrome while a per-element capture is in flight", () => {
    document.body.innerHTML = '<button id="a">A</button>';
    const a = byId("a");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(a);
    // jsdom returns a 0-area rect for `<button>`; force a positive one so
    // `requestScreenshot` reaches the chrome.runtime path instead of bailing
    // out via the clampToViewport(null) early-return.
    vi.spyOn(a, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      width: 50,
      height: 20,
      bottom: 20,
      right: 50,
      toJSON: () => ({}),
    } as DOMRect);
    // Stub chrome with a never-resolving sendMessage — onResult never fires,
    // so the in-flight counter stays at 1 and the chrome hide stays in effect
    // for us to assert against.
    vi.stubGlobal("chrome", {
      runtime: { sendMessage: vi.fn().mockReturnValue(new Promise(() => {})) },
    });

    setupController({ sidebarRoot: null });
    pressElement();
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 5 }));
    clickElement(a, { altKey: true });

    // After Alt+click, the picker chrome should be hidden — the rAF inside
    // schedulePendingScreenshot has fired (rAF is stubbed synchronously),
    // sendMessage was sent but never resolved, and the counter is 1.
    const overlay = document.getElementById("rmk-picker-overlay");
    const label = document.getElementById("rmk-picker-label");
    const styles = document.getElementById("rmk-picker-styles");
    expect(overlay?.style.visibility).toBe("hidden");
    expect(label?.style.visibility).toBe("hidden");
    expect(styles?.style.visibility).toBe("hidden");
  });

  it("restores picker chrome after the screenshot result lands", async () => {
    document.body.innerHTML = '<button id="a">A</button>';
    const a = byId("a");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(a);
    vi.spyOn(a, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      width: 50,
      height: 20,
      bottom: 20,
      right: 50,
      toJSON: () => ({}),
    } as DOMRect);

    // Stub chrome.runtime.sendMessage to resolve with a successful capture
    // result so requestScreenshot fires its onResult.
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      kind: "capture-screenshot",
      dataUrl: "data:image/png;base64,xx",
      width: 10,
      height: 5,
    });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });

    setupController({ sidebarRoot: null });
    pressElement();
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 5 }));
    clickElement(a, { altKey: true });
    await flushMicrotasks();

    const overlay = document.getElementById("rmk-picker-overlay");
    expect(overlay?.style.visibility).toBe("");
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
