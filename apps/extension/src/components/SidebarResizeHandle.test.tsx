import { HEIGHT_MAX, HEIGHT_MIN, WIDTH_MAX, WIDTH_MIN } from "@/lib/sidebar-store";
import { describe, expect, it } from "vitest";
import { computeNextSize } from "./SidebarResizeHandle";

describe("computeNextSize", () => {
  it("grows width when dragging the right dock's inner edge leftward", () => {
    // right dock: handle is on the left edge; pointer moves left => width grows
    const next = computeNextSize({
      dock: "right",
      startWidth: 320,
      startHeight: 400,
      deltaX: -40,
      deltaY: 0,
    });
    expect(next.width).toBe(360);
    expect(next.height).toBe(400);
  });

  it("shrinks width when dragging the right dock's inner edge rightward", () => {
    const next = computeNextSize({
      dock: "right",
      startWidth: 400,
      startHeight: 400,
      deltaX: 50,
      deltaY: 0,
    });
    expect(next.width).toBe(350);
  });

  it("grows width when dragging the left dock's inner edge rightward", () => {
    const next = computeNextSize({
      dock: "left",
      startWidth: 320,
      startHeight: 400,
      deltaX: 40,
      deltaY: 0,
    });
    expect(next.width).toBe(360);
  });

  it("grows height when dragging the bottom dock's top edge upward", () => {
    const next = computeNextSize({
      dock: "bottom",
      startWidth: 320,
      startHeight: 250,
      deltaX: 0,
      deltaY: -40,
    });
    expect(next.height).toBe(290);
    expect(next.width).toBe(320);
  });

  it("clamps width to [WIDTH_MIN, WIDTH_MAX]", () => {
    const tooNarrow = computeNextSize({
      dock: "right",
      startWidth: 320,
      startHeight: 400,
      deltaX: 9999,
      deltaY: 0,
    });
    expect(tooNarrow.width).toBe(WIDTH_MIN);

    const tooWide = computeNextSize({
      dock: "right",
      startWidth: 320,
      startHeight: 400,
      deltaX: -9999,
      deltaY: 0,
    });
    expect(tooWide.width).toBe(WIDTH_MAX);
  });

  it("clamps height to [HEIGHT_MIN, HEIGHT_MAX]", () => {
    const tooShort = computeNextSize({
      dock: "bottom",
      startWidth: 320,
      startHeight: 250,
      deltaX: 0,
      deltaY: 9999,
    });
    expect(tooShort.height).toBe(HEIGHT_MIN);

    const tooTall = computeNextSize({
      dock: "bottom",
      startWidth: 320,
      startHeight: 250,
      deltaX: 0,
      deltaY: -9999,
    });
    expect(tooTall.height).toBe(HEIGHT_MAX);
  });
});
