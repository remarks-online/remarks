// Minimal `chrome.runtime.id` so `isExtensionContextValid()` (in
// src/lib/extension-context.ts) treats the test as a live extension context.
// Specs that mock `wxt/utils/storage` don't otherwise need a `chrome` global,
// but the runtime-context guard checks for it.
if (typeof (globalThis as { chrome?: unknown }).chrome === "undefined") {
  (globalThis as { chrome: unknown }).chrome = { runtime: { id: "test-extension" } };
}

// jsdom ships `window.CSS` but not every build exposes `CSS.escape` on globalThis.
// Polyfill the spec's two escape rules we rely on so the picker logic is testable.
// https://www.w3.org/TR/cssom-1/#the-css.escape()-method
if (typeof globalThis.CSS === "undefined" || typeof globalThis.CSS.escape !== "function") {
  const escape = (value: string): string => {
    const str = String(value);
    let result = "";
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      if (ch === 0x0000) {
        result += "�";
      } else if (
        (ch >= 0x0001 && ch <= 0x001f) ||
        ch === 0x007f ||
        (i === 0 && ch >= 0x0030 && ch <= 0x0039) ||
        (i === 1 && ch >= 0x0030 && ch <= 0x0039 && str.charCodeAt(0) === 0x002d)
      ) {
        result += `\\${ch.toString(16)} `;
      } else if (i === 0 && ch === 0x002d && str.length === 1) {
        result += `\\${str.charAt(i)}`;
      } else if (
        ch >= 0x0080 ||
        ch === 0x002d ||
        ch === 0x005f ||
        (ch >= 0x0030 && ch <= 0x0039) ||
        (ch >= 0x0041 && ch <= 0x005a) ||
        (ch >= 0x0061 && ch <= 0x007a)
      ) {
        result += str.charAt(i);
      } else {
        result += `\\${str.charAt(i)}`;
      }
    }
    return result;
  };
  globalThis.CSS = { ...(globalThis.CSS ?? {}), escape } as typeof CSS;
}

// jsdom does not implement elementFromPoint on Document or ShadowRoot. The
// picker-controller tests spy on it, so we install a stub that returns null and
// lets vi.spyOn override it per test.
if (typeof Document !== "undefined" && typeof Document.prototype.elementFromPoint !== "function") {
  Document.prototype.elementFromPoint = function (): Element | null {
    return null;
  };
}
if (
  typeof ShadowRoot !== "undefined" &&
  typeof ShadowRoot.prototype.elementFromPoint !== "function"
) {
  ShadowRoot.prototype.elementFromPoint = function (): Element | null {
    return null;
  };
}
