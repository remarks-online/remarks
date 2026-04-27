import { afterEach, describe, expect, it } from "vitest";
import { isInSidebarUi, isTypingEvent, isTypingTarget } from "./picker-guards";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("isInSidebarUi", () => {
  it("returns false when sidebar root is null", () => {
    const evt = new MouseEvent("click");
    expect(isInSidebarUi(evt, null)).toBe(false);
  });

  it("returns true when the event path traverses the sidebar shadow root", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const inner = document.createElement("button");
    shadow.appendChild(inner);

    let captured = false;
    window.addEventListener(
      "click",
      (e) => {
        captured = isInSidebarUi(e, shadow);
      },
      { capture: true, once: true }
    );
    inner.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(captured).toBe(true);
  });

  it("returns false when the event originates outside the sidebar", () => {
    const host = document.createElement("div");
    const outside = document.createElement("a");
    document.body.append(host, outside);
    const shadow = host.attachShadow({ mode: "open" });

    let captured = true;
    window.addEventListener(
      "click",
      (e) => {
        captured = isInSidebarUi(e, shadow);
      },
      { capture: true, once: true }
    );
    outside.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(captured).toBe(false);
  });
});

describe("isTypingTarget", () => {
  it("returns false for null / non-elements", () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
  });

  it("returns true for text-ish inputs", () => {
    const input = document.createElement("input");
    input.type = "text";
    expect(isTypingTarget(input)).toBe(true);
    input.type = "email";
    expect(isTypingTarget(input)).toBe(true);
    input.type = "search";
    expect(isTypingTarget(input)).toBe(true);
  });

  it("returns false for widget inputs (checkbox, button, etc.)", () => {
    const input = document.createElement("input");
    input.type = "checkbox";
    expect(isTypingTarget(input)).toBe(false);
    input.type = "button";
    expect(isTypingTarget(input)).toBe(false);
  });

  it("returns true for textarea and select", () => {
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("select"))).toBe(true);
  });

  it("returns true for contenteditable elements", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    expect(isTypingTarget(div)).toBe(true);
  });

  it("returns true for ARIA typing roles", () => {
    const div = document.createElement("div");
    div.setAttribute("role", "textbox");
    expect(isTypingTarget(div)).toBe(true);
  });

  it("returns false for plain elements", () => {
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
  });
});

describe("isTypingEvent", () => {
  // composedPath() returns the live path only during dispatch — after the
  // event finishes, the array is empty. Capture the result inside a listener.
  function checkDuringDispatch(target: EventTarget, event: KeyboardEvent): boolean {
    let result = false;
    const listener = (e: Event) => {
      result = isTypingEvent(e);
    };
    target.addEventListener("keydown", listener, { capture: true });
    try {
      target.dispatchEvent(event);
    } finally {
      target.removeEventListener("keydown", listener, { capture: true });
    }
    return result;
  }

  it("detects a textarea inside a shadow root via composedPath", () => {
    // The original bug: a window-level listener saw event.target as the
    // shadow host, and document.activeElement also pointed at the host — so
    // `isTypingTarget(document.activeElement)` returned false and the bare
    // 'r' hotkey ate keystrokes meant for the textarea.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const textarea = document.createElement("textarea");
    shadow.appendChild(textarea);

    const event = new KeyboardEvent("keydown", {
      key: "r",
      bubbles: true,
      composed: true,
    });
    expect(checkDuringDispatch(textarea, event)).toBe(true);
  });

  it("falls back to document.activeElement when the path skips the input", () => {
    // Synthetic events dispatched directly on `window` have a composedPath
    // that doesn't include the focused element. Real keyboard events never
    // look like this, but tests use the pattern, so the fallback keeps the
    // guard correct in both cases.
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent("keydown", { key: "r" });
    expect(checkDuringDispatch(window, event)).toBe(true);
  });

  it("returns false when nothing is focused and the path is plain DOM", () => {
    const event = new KeyboardEvent("keydown", { key: "r" });
    expect(checkDuringDispatch(document.body, event)).toBe(false);
  });
});
