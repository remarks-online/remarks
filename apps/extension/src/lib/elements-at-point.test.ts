import { afterEach, describe, expect, it, vi } from "vitest";
import { elementAtPoint } from "./elements-at-point";
import { byId } from "./test-utils";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("elementAtPoint", () => {
  it("returns null when nothing is at the point", () => {
    vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
    expect(elementAtPoint(10, 10)).toBeNull();
  });

  it("returns the top element when no shadow root is present", () => {
    document.body.innerHTML = '<button id="b">x</button>';
    const btn = byId("b");
    vi.spyOn(document, "elementFromPoint").mockReturnValue(btn);
    expect(elementAtPoint(10, 10)).toBe(btn);
  });

  it("drills into open shadow roots until they stop reporting new elements", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const inner = document.createElement("button");
    inner.textContent = "shadow child";
    shadow.appendChild(inner);
    document.body.appendChild(host);

    vi.spyOn(document, "elementFromPoint").mockReturnValue(host);
    vi.spyOn(shadow, "elementFromPoint").mockReturnValue(inner);

    const result = elementAtPoint(10, 10);
    expect(result).toBe(inner);
  });

  it("stops at maxShadowDepth", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const innerHost = document.createElement("div");
    const inner2 = innerHost.attachShadow({ mode: "open" });
    const leaf = document.createElement("span");
    inner2.appendChild(leaf);
    shadow.appendChild(innerHost);
    document.body.appendChild(host);

    vi.spyOn(document, "elementFromPoint").mockReturnValue(host);
    vi.spyOn(shadow, "elementFromPoint").mockReturnValue(innerHost);
    const leafSpy = vi.spyOn(inner2, "elementFromPoint").mockReturnValue(leaf);

    expect(elementAtPoint(10, 10, document, { maxShadowDepth: 1 })).toBe(innerHost);
    expect(leafSpy).not.toHaveBeenCalled();
  });
});
