import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerSidebarShortcuts } from "./sidebar-shortcuts";
import { sidebarStore } from "./sidebar-store";

function keydown(init: KeyboardEventInit & { target?: EventTarget | null } = {}) {
  const ev = new KeyboardEvent("keydown", { cancelable: true, bubbles: true, ...init });
  if (init.target) Object.defineProperty(ev, "target", { value: init.target });
  window.dispatchEvent(ev);
  return ev;
}

let teardown: (() => void) | null = null;

beforeEach(() => {
  sidebarStore.getState().reset();
  teardown = registerSidebarShortcuts();
});

afterEach(() => {
  teardown?.();
  teardown = null;
});

describe("⌘⇧F — toggle visible", () => {
  it("flips visibility on Meta+Shift+F", () => {
    sidebarStore.getState().setVisible(true);
    keydown({ key: "F", code: "KeyF", metaKey: true, shiftKey: true });
    expect(sidebarStore.getState().visible).toBe(false);
  });

  it("flips visibility on Ctrl+Shift+F", () => {
    sidebarStore.getState().setVisible(true);
    keydown({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true });
    expect(sidebarStore.getState().visible).toBe(false);
  });

  it("matches by event.code so a Shift-mangled key still works", () => {
    sidebarStore.getState().setVisible(true);
    // Some keyboards/IMEs emit a different `key` under Shift but `code` is stable.
    keydown({ key: "f", code: "KeyF", metaKey: true, shiftKey: true });
    expect(sidebarStore.getState().visible).toBe(false);
  });

  it("does nothing without Shift", () => {
    sidebarStore.getState().setVisible(true);
    keydown({ key: "F", code: "KeyF", metaKey: true });
    expect(sidebarStore.getState().visible).toBe(true);
  });

  it("ignores ⌘⇧F when typing in a textarea inside a shadow root", () => {
    // Regression for the same shadow-retargeting class of bug as the picker
    // controller — composedPath()[0] resolves the deep target.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const textarea = document.createElement("textarea");
    shadow.appendChild(textarea);

    sidebarStore.getState().setVisible(true);
    const ev = new KeyboardEvent("keydown", {
      key: "F",
      code: "KeyF",
      metaKey: true,
      shiftKey: true,
      cancelable: true,
      bubbles: true,
      composed: true,
    });
    textarea.dispatchEvent(ev);
    expect(sidebarStore.getState().visible).toBe(true);

    host.remove();
  });
});

describe("⌘⇧D — cycle dock", () => {
  it("advances the dock", () => {
    sidebarStore.getState().setDock("right");
    keydown({ key: "D", code: "KeyD", metaKey: true, shiftKey: true });
    expect(sidebarStore.getState().dock).toBe("left");
  });
});

describe("teardown", () => {
  it("stops responding to shortcuts after teardown", () => {
    teardown?.();
    teardown = null;
    sidebarStore.getState().setVisible(true);
    keydown({ key: "F", code: "KeyF", metaKey: true, shiftKey: true });
    expect(sidebarStore.getState().visible).toBe(true);
  });
});
