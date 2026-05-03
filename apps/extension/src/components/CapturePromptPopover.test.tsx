import { type ElementCapture, pickerStore } from "@/lib/picker-store";
import { sidebarStore } from "@/lib/sidebar-store";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/shadow-root-context", () => ({
  useShadowRootPortalContainer: () => null,
}));

const { CapturePromptPopover } = await import("./CapturePromptPopover");

function makeElementCapture(overrides: Partial<ElementCapture> = {}): ElementCapture {
  return {
    kind: "element",
    selector: "#a",
    strategy: "id",
    domContext: { tagName: "button" },
    url: "https://example.test/page",
    viewport: { width: 1280, height: 720, dpr: 1 },
    scroll: { x: 0, y: 0 },
    targetCoords: { x: 0, y: 0, width: 100, height: 40 },
    capturedAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  pickerStore.setState({
    mode: "idle",
    hovered: null,
    capture: null,
    popoverDismissed: false,
    multiSelectMode: false,
    pendingSelections: [],
  });
  sidebarStore.getState().reset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CapturePromptPopover — multi-select (G17)", () => {
  test("renders one row per pendingSelection when group is non-empty", () => {
    const a = makeElementCapture({ selector: "#a" });
    const b = makeElementCapture({ selector: "#b" });
    const c = makeElementCapture({ selector: "#c" });
    pickerStore.setState({
      capture: c, // anchor
      pendingSelections: [a, b, c],
    });
    render(<CapturePromptPopover onSubmit={() => {}} />);

    expect(screen.getByText("3 elements selected")).toBeTruthy();
    expect(screen.getByText("#a")).toBeTruthy();
    expect(screen.getByText("#b")).toBeTruthy();
    expect(screen.getByText("#c")).toBeTruthy();
  });

  test("per-row remove drops the selection from the store", () => {
    const a = makeElementCapture({ selector: "#a" });
    const b = makeElementCapture({ selector: "#b" });
    const c = makeElementCapture({ selector: "#c" });
    pickerStore.setState({ capture: c, pendingSelections: [a, b, c] });
    render(<CapturePromptPopover onSubmit={() => {}} />);

    act(() => {
      fireEvent.click(screen.getByLabelText("Remove element 2"));
    });
    expect(pickerStore.getState().pendingSelections.map((p) => p.selector)).toEqual(["#a", "#c"]);
  });

  test("submit forwards the full pendingSelections array as captures", () => {
    const a = makeElementCapture({ selector: "#a" });
    const b = makeElementCapture({ selector: "#b" });
    pickerStore.setState({ capture: b, pendingSelections: [a, b] });
    sidebarStore.getState().setDraftComment("match these");

    const onSubmit = vi.fn();
    render(<CapturePromptPopover onSubmit={onSubmit} />);

    act(() => {
      fireEvent.click(screen.getByText("Post"));
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [text, captures, classifiers] = onSubmit.mock.calls[0] ?? [];
    expect(text).toBe("match these");
    expect(captures).toHaveLength(2);
    expect(captures.map((c: ElementCapture) => c.selector)).toEqual(["#a", "#b"]);
    expect(classifiers).toEqual({ intent: null, severity: null });
  });

  test("single-pick path passes a one-element captures array", () => {
    const a = makeElementCapture({ selector: "#only" });
    pickerStore.setState({ capture: a, pendingSelections: [] });
    sidebarStore.getState().setDraftComment("solo");

    const onSubmit = vi.fn();
    render(<CapturePromptPopover onSubmit={onSubmit} />);

    act(() => {
      fireEvent.click(screen.getByText("Post"));
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const captures = onSubmit.mock.calls[0]?.[1];
    expect(captures).toHaveLength(1);
    expect(captures[0].selector).toBe("#only");
  });

  test("removing the last sibling collapses the stack to a single survivor", () => {
    const a = makeElementCapture({ selector: "#a" });
    const b = makeElementCapture({ selector: "#second" });
    pickerStore.setState({ capture: a, pendingSelections: [a, b] });
    render(<CapturePromptPopover onSubmit={() => {}} />);

    act(() => {
      fireEvent.click(screen.getByLabelText("Remove element 2"));
    });
    // handleRemove leaves one entry; popover falls through to single-element
    // rendering on the survivor.
    expect(pickerStore.getState().pendingSelections).toHaveLength(1);
    expect(pickerStore.getState().pendingSelections[0]?.selector).toBe("#a");
  });
});
