import { afterEach, describe, expect, it } from "vitest";
import { isInSidebarUi, isTypingTarget } from "./picker-guards";

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
