import { afterEach, describe, expect, it } from "vitest";
import { generateSelector } from "./selector-generator";
import { q, qa } from "./test-utils";

afterEach(() => {
  document.body.innerHTML = "";
});

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

describe("generateSelector", () => {
  describe("id strategy", () => {
    it("prefers a stable id", () => {
      mount('<button id="submit">Go</button>');
      const result = generateSelector(q("button"));
      expect(result).toEqual({ selector: "#submit", strategy: "id" });
    });

    it("escapes ids with CSS-special characters", () => {
      mount('<div id="foo.bar"></div>');
      const result = generateSelector(q("div"));
      expect(result.selector).toBe("#foo\\.bar");
      expect(result.strategy).toBe("id");
    });

    it("skips auto-generated React useId values", () => {
      mount('<div id=":r1:"><button data-testid="go">Go</button></div>');
      const result = generateSelector(q("button"));
      expect(result.strategy).not.toBe("id");
      expect(result.selector).toBe('button[data-testid="go"]');
    });

    it("skips UUID-shaped ids", () => {
      mount('<p id="9c1b2f9a-0000-4aaa-bbbb-cccccccccccc" data-testid="para"></p>');
      const result = generateSelector(q("p"));
      expect(result.strategy).toBe("data-testid");
    });
  });

  describe("data-testid strategy", () => {
    it("uses data-testid when no id", () => {
      mount('<input data-testid="email-input" />');
      const result = generateSelector(q("input"));
      expect(result).toEqual({
        selector: 'input[data-testid="email-input"]',
        strategy: "data-testid",
      });
    });
  });

  describe("class strategy", () => {
    it("uses tag + first two non-utility classes", () => {
      mount('<button class="primary cta flex px-4">Go</button>');
      const result = generateSelector(q("button"));
      expect(result.strategy).toBe("class");
      expect(result.selector).toBe("button.primary.cta");
    });

    it("filters responsive and state Tailwind variants", () => {
      mount('<a class="hover:text-red-500 md:flex custom-link">x</a>');
      const result = generateSelector(q("a"));
      expect(result.strategy).toBe("class");
      expect(result.selector).toBe("a.custom-link");
    });

    it("filters arbitrary-value Tailwind classes", () => {
      mount('<span class="text-[#ff0000] meaningful">x</span>');
      const result = generateSelector(q("span"));
      expect(result.selector).toBe("span.meaningful");
    });

    it("ignores rmk-/db-/moat- namespace classes", () => {
      mount('<section class="rmk-sidebar db-root moat-panel real-class">x</section>');
      const result = generateSelector(q("section"));
      expect(result.selector).toBe("section.real-class");
    });
  });

  describe("nth-child-path fallback", () => {
    it("walks ancestors when no id/testid/class is unique", () => {
      mount(`
        <main>
          <section>
            <div><p>first</p><p>second</p></div>
          </section>
        </main>
      `);
      const target = qa("p")[1];
      if (!target) throw new Error("expected second <p>");
      const result = generateSelector(target);
      expect(result.strategy).toBe("nth-child-path");
      expect(result.selector).toContain(":nth-child(2)");
    });

    it("omits nth-child when there is a single sibling of the same tag", () => {
      mount("<main><section><p>only</p></section></main>");
      const result = generateSelector(q("p"));
      expect(result.selector).not.toContain(":nth-child");
    });

    it("anchors to nearest safe id when an ancestor has one", () => {
      mount(`
        <main id="app">
          <section><article><span>here</span></article></section>
        </main>
      `);
      const result = generateSelector(q("span"));
      expect(result.selector.startsWith("#app")).toBe(true);
    });

    it("truncates to last four ancestors for readability", () => {
      mount(
        "<div><div><div><div><div><div><div><em>x</em></div></div></div></div></div></div></div>"
      );
      const result = generateSelector(q("em"));
      expect(result.strategy).toBe("nth-child-path");
      const segments = result.selector.split(" > ");
      expect(segments.length).toBeLessThanOrEqual(4);
    });
  });

  describe("uniqueness fallback", () => {
    it("falls through to class when id is non-unique (duplicate ids in DOM)", () => {
      mount(
        '<div><span id="dup" class="a">first</span><span id="dup" class="b">second</span></div>'
      );
      const target = qa("span")[1];
      if (!target) throw new Error("expected second <span>");
      const result = generateSelector(target);
      expect(result.strategy).toBe("class");
      expect(result.selector).toBe("span.b");
    });
  });

  it("handles SVG elements with lowercased tag names", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><circle class="dot" r="5"/></svg>`;
    mount(svg);
    const result = generateSelector(q("circle"));
    expect(result.selector.startsWith("circle")).toBe(true);
  });
});
