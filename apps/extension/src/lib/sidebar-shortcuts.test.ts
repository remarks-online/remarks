import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSidebarShortcuts } from "./sidebar-shortcuts";
import { sidebarStore } from "./sidebar-store";

function keydown(init: KeyboardEventInit & { target?: EventTarget | null } = {}) {
  const ev = new KeyboardEvent("keydown", { cancelable: true, bubbles: true, ...init });
  if (init.target) Object.defineProperty(ev, "target", { value: init.target });
  window.dispatchEvent(ev);
  return ev;
}

let teardown: (() => void) | null = null;
let onFocusCompose: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sidebarStore.getState().reset();
  onFocusCompose = vi.fn();
  teardown = registerSidebarShortcuts({ onFocusCompose });
});

afterEach(() => {
  teardown?.();
  teardown = null;
});

describe("Cmd/Ctrl+Shift+F — toggle visible", () => {
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

  it("is accepted case-insensitively", () => {
    sidebarStore.getState().setVisible(true);
    keydown({ key: "f", code: "KeyF", metaKey: true, shiftKey: true });
    expect(sidebarStore.getState().visible).toBe(false);
  });

  it("does nothing without Shift", () => {
    sidebarStore.getState().setVisible(true);
    keydown({ key: "F", code: "KeyF", metaKey: true });
    expect(sidebarStore.getState().visible).toBe(true);
  });
});

describe("Cmd/Ctrl+Shift+D — cycle dock", () => {
  it("advances the dock", () => {
    sidebarStore.getState().setDock("right");
    keydown({ key: "D", code: "KeyD", metaKey: true, shiftKey: true });
    expect(sidebarStore.getState().dock).toBe("left");
  });
});

describe("F — focus compose", () => {
  it("calls onFocusCompose for a plain F", () => {
    keydown({ key: "F", code: "KeyF" });
    expect(onFocusCompose).toHaveBeenCalledTimes(1);
  });

  it("ignores F when the target is an input", () => {
    const input = document.createElement("input");
    document.body.append(input);
    try {
      keydown({ key: "F", code: "KeyF", target: input });
      expect(onFocusCompose).not.toHaveBeenCalled();
    } finally {
      input.remove();
    }
  });

  it("ignores F when the target is a contentEditable node", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    document.body.append(div);
    try {
      keydown({ key: "F", code: "KeyF", target: div });
      expect(onFocusCompose).not.toHaveBeenCalled();
    } finally {
      div.remove();
    }
  });

  it("ignores F when combined with a modifier", () => {
    keydown({ key: "F", code: "KeyF", metaKey: true });
    expect(onFocusCompose).not.toHaveBeenCalled();
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
