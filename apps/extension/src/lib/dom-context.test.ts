import { MAX_TEXT_CONTENT_LENGTH, domContextSchema } from "@remarks/shared";
import { afterEach, describe, expect, it } from "vitest";
import { buildDomContext } from "./dom-context";
import { q } from "./test-utils";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("buildDomContext", () => {
  it("captures tagName + classes + textContent", () => {
    document.body.innerHTML = '<button class="primary submit">Place order</button>';
    const ctx = buildDomContext(q("button"));
    expect(ctx).toMatchObject({
      tagName: "button",
      classes: ["primary", "submit"],
      textContent: "Place order",
    });
    expect(domContextSchema.parse(ctx)).toEqual(ctx);
  });

  it("truncates textContent at MAX_TEXT_CONTENT_LENGTH", () => {
    const long = "a".repeat(MAX_TEXT_CONTENT_LENGTH + 100);
    document.body.innerHTML = `<p>${long}</p>`;
    const ctx = buildDomContext(q("p"));
    expect(ctx.textContent?.length).toBeLessThanOrEqual(MAX_TEXT_CONTENT_LENGTH);
    expect(ctx.textContent?.endsWith("…")).toBe(true);
  });

  it("collects up to five ancestors from element toward body", () => {
    document.body.innerHTML = `
      <main><section><article><div><span><em><b>x</b></em></span></div></article></section></main>
    `;
    const ctx = buildDomContext(q("b"));
    expect(ctx.ancestors?.length).toBe(5);
    expect(ctx.ancestors?.[0]?.tagName).toBe("em");
  });

  it("omits classes when ancestor has none", () => {
    document.body.innerHTML = "<section><p>hi</p></section>";
    const ctx = buildDomContext(q("p"));
    expect(ctx.ancestors?.[0]).toEqual({ tagName: "section" });
  });

  it("omits textContent when element is empty", () => {
    document.body.innerHTML = '<div class="a"></div>';
    const ctx = buildDomContext(q("div"));
    expect(ctx.textContent).toBeUndefined();
  });

  it("produces a result parseable by domContextSchema", () => {
    document.body.innerHTML =
      '<main><section class="x y"><button class="btn">Click</button></section></main>';
    const ctx = buildDomContext(q("button"));
    expect(() => domContextSchema.parse(ctx)).not.toThrow();
  });

  it("captures whitelisted computed styles when set inline", () => {
    document.body.innerHTML =
      '<div style="display: flex; color: rgb(255, 0, 0); padding: 8px;"></div>';
    const ctx = buildDomContext(q("div"));
    expect(ctx.computedStyles?.display).toBe("flex");
    expect(ctx.computedStyles?.color).toBe("rgb(255, 0, 0)");
    expect(ctx.computedStyles?.padding).toBe("8px");
  });

  it("drops noise values like 'none' / 'auto' from computed styles", () => {
    document.body.innerHTML =
      '<div style="display: block; background-image: none; top: auto;"></div>';
    const ctx = buildDomContext(q("div"));
    expect(ctx.computedStyles?.display).toBe("block");
    expect(ctx.computedStyles?.["background-image"]).toBeUndefined();
    expect(ctx.computedStyles?.top).toBeUndefined();
  });

  it("caps computed styles at MAX_COMPUTED_STYLE_KEYS", () => {
    document.body.innerHTML = "<div></div>";
    const ctx = buildDomContext(q("div"));
    if (ctx.computedStyles) {
      expect(Object.keys(ctx.computedStyles).length).toBeLessThanOrEqual(40);
    }
  });
});
