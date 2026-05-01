import { afterEach, describe, expect, it } from "vitest";
import { getDisplayName, getFiberFromElement, getSource, walkComponentChain } from "./react-fiber";

const FORWARD_REF = Symbol.for("react.forward_ref");
const MEMO = Symbol.for("react.memo");
const LAZY = Symbol.for("react.lazy");
const PROVIDER = Symbol.for("react.provider");
const CONTEXT = Symbol.for("react.context");

interface FakeFiber {
  return: FakeFiber | null;
  alternate: FakeFiber | null;
  type: unknown;
  elementType: unknown;
  stateNode: unknown;
  _debugSource?: { fileName?: unknown; lineNumber?: unknown; columnNumber?: unknown } | null;
}

function makeFiber(
  type: unknown,
  parent: FakeFiber | null = null,
  source?: FakeFiber["_debugSource"]
): FakeFiber {
  return {
    return: parent,
    alternate: null,
    type,
    elementType: type,
    stateNode: null,
    _debugSource: source ?? null,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("getFiberFromElement", () => {
  it("returns null when no fiber key is present", () => {
    document.body.innerHTML = "<div></div>";
    const el = document.querySelector("div") as HTMLElement;
    expect(getFiberFromElement(el)).toBeNull();
  });

  it("finds a fiber attached under the React 17+ key prefix", () => {
    document.body.innerHTML = "<div></div>";
    const el = document.querySelector("div") as HTMLElement;
    const fiber = makeFiber("div");
    (el as unknown as Record<string, unknown>).__reactFiber$x9z = fiber;
    expect(getFiberFromElement(el)).toBe(fiber);
  });

  it("falls back to the React 16 internal-instance key prefix", () => {
    document.body.innerHTML = "<div></div>";
    const el = document.querySelector("div") as HTMLElement;
    const fiber = makeFiber("div");
    (el as unknown as Record<string, unknown>).__reactInternalInstance$abc = fiber;
    expect(getFiberFromElement(el)).toBe(fiber);
  });
});

describe("getDisplayName", () => {
  it("returns 'Anonymous' for null/undefined", () => {
    expect(getDisplayName(null)).toBe("Anonymous");
    expect(getDisplayName(undefined)).toBe("Anonymous");
  });

  it("returns the host tag name for string types", () => {
    expect(getDisplayName("div")).toBe("div");
  });

  it("prefers displayName over function name", () => {
    function Inner() {
      return null;
    }
    (Inner as unknown as { displayName: string }).displayName = "Outer";
    expect(getDisplayName(Inner)).toBe("Outer");
  });

  it("falls back to function name when displayName is missing", () => {
    function MyButton() {
      return null;
    }
    expect(getDisplayName(MyButton)).toBe("MyButton");
  });

  it("recurses into forwardRef wrappers", () => {
    function Inner() {
      return null;
    }
    const wrapped = { $$typeof: FORWARD_REF, render: Inner };
    expect(getDisplayName(wrapped)).toBe("ForwardRef(Inner)");
  });

  it("recurses into memo wrappers", () => {
    function Inner() {
      return null;
    }
    const wrapped = { $$typeof: MEMO, type: Inner };
    expect(getDisplayName(wrapped)).toBe("Memo(Inner)");
  });

  it("recognizes lazy with a resolved payload", () => {
    function Inner() {
      return null;
    }
    const wrapped = { $$typeof: LAZY, _payload: { _result: Inner } };
    expect(getDisplayName(wrapped)).toBe("Lazy(Inner)");
  });

  it("returns Provider/Context for the well-known $$typeofs", () => {
    expect(getDisplayName({ $$typeof: PROVIDER })).toBe("Provider");
    expect(getDisplayName({ $$typeof: CONTEXT })).toBe("Context");
  });
});

describe("walkComponentChain", () => {
  it("returns leaf-to-root component names skipping host fibers", () => {
    function Button() {
      return null;
    }
    function Form() {
      return null;
    }
    function Page() {
      return null;
    }
    const root = makeFiber(Page);
    const div = makeFiber("div", root);
    const form = makeFiber(Form, div);
    const span = makeFiber("span", form);
    const button = makeFiber(Button, span);
    const chain = walkComponentChain(button);
    expect(chain.map((c) => c.name)).toEqual(["Button", "Form", "Page"]);
    expect(chain.map((c) => c.kind)).toEqual(["function", "function", "function"]);
  });

  it("dedupes adjacent identical names from memo/forwardRef wrappers", () => {
    function Button() {
      return null;
    }
    (Button as unknown as { displayName: string }).displayName = "Button";
    const wrapper = { $$typeof: MEMO, type: Button, displayName: "Button" };
    const root = makeFiber(Button);
    const inner = makeFiber(Button, root);
    const outer = makeFiber(wrapper, inner);
    const chain = walkComponentChain(outer);
    expect(chain.map((c) => c.name)).toEqual(["Button"]);
  });

  it("respects the maxDepth cap", () => {
    // Build a 30-deep chain root → leaf, where each fiber's `.return` points
    // at its parent. After the loop, `parent` is the leaf — the last `next`
    // we built — and walkComponentChain should cap at maxDepth.
    let parent: FakeFiber | null = null;
    for (let i = 0; i < 30; i++) {
      parent = makeFiber({ displayName: `C${i}` }, parent);
    }
    if (!parent) throw new Error("test setup failed");
    const chain = walkComponentChain(parent, 5);
    expect(chain.length).toBe(5);
  });

  it("classifies class components", () => {
    class MyClass {
      render() {
        return null;
      }
    }
    (MyClass.prototype as unknown as { isReactComponent: boolean }).isReactComponent = true;
    const fiber = makeFiber(MyClass);
    const [node] = walkComponentChain(fiber);
    expect(node?.kind).toBe("class");
  });
});

describe("getSource", () => {
  it("returns undefined when _debugSource is null", () => {
    const fiber = makeFiber(() => null, null, null);
    expect(getSource(fiber)).toBeUndefined();
  });

  it("returns fileName + lineNumber when present", () => {
    const fiber = makeFiber(() => null, null, {
      fileName: "/abs/path/MyComp.tsx",
      lineNumber: 42,
      columnNumber: 7,
    });
    expect(getSource(fiber)).toEqual({
      fileName: "/abs/path/MyComp.tsx",
      lineNumber: 42,
      columnNumber: 7,
    });
  });

  it("omits columnNumber when missing", () => {
    const fiber = makeFiber(() => null, null, { fileName: "/x.tsx", lineNumber: 1 });
    expect(getSource(fiber)).toEqual({ fileName: "/x.tsx", lineNumber: 1 });
  });
});
