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
    expect(ctx).toEqual({
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
});
