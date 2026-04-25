import { describe, expect, it } from "vitest";
import { POPOVER_EDGE_PADDING, POPOVER_GAP, computePopoverPlacement } from "./popover-position";

const viewport = { width: 1024, height: 768 };
const popover = { width: 320, height: 200 };

describe("computePopoverPlacement", () => {
  it("places the popover below the target when there is room below", () => {
    const result = computePopoverPlacement({
      target: { x: 100, y: 100, width: 200, height: 40 },
      scroll: { x: 0, y: 0 },
      viewport,
      popover,
    });
    expect(result.placement).toBe("below");
    expect(result.top).toBe(100 + 40 + POPOVER_GAP);
    expect(result.left).toBe(100);
  });

  it("flips above when below would clip and there is room above", () => {
    // Target near the bottom edge: not enough room below, plenty above.
    const result = computePopoverPlacement({
      target: { x: 100, y: 700, width: 100, height: 40 },
      scroll: { x: 0, y: 0 },
      viewport,
      popover,
    });
    expect(result.placement).toBe("above");
    expect(result.top).toBe(700 - popover.height - POPOVER_GAP);
  });

  it("clamps the left edge when the target is near the right edge of the viewport", () => {
    const result = computePopoverPlacement({
      target: { x: 980, y: 100, width: 30, height: 30 },
      scroll: { x: 0, y: 0 },
      viewport,
      popover,
    });
    // 980 + 320 = 1300 > 1024, so clamp to viewport.width - popover.width - pad.
    expect(result.left).toBe(viewport.width - popover.width - POPOVER_EDGE_PADDING);
  });

  it("clamps the left edge to the padding when the target sits to the left of the viewport", () => {
    const result = computePopoverPlacement({
      target: { x: -50, y: 100, width: 30, height: 30 },
      scroll: { x: 0, y: 0 },
      viewport,
      popover,
    });
    expect(result.left).toBe(POPOVER_EDGE_PADDING);
  });

  it("subtracts scroll offset so document coords map to viewport coords", () => {
    const result = computePopoverPlacement({
      target: { x: 100, y: 1000, width: 50, height: 50 },
      scroll: { x: 0, y: 800 },
      viewport,
      popover,
    });
    // Target sits at viewport y = 1000 - 800 = 200; popover goes below at 200 + 50 + GAP.
    expect(result.placement).toBe("below");
    expect(result.top).toBe(200 + 50 + POPOVER_GAP);
  });

  it("keeps the popover at least partially visible when neither side fits", () => {
    // Target dominates the viewport: no room above or below.
    const tinyViewport = { width: 1024, height: 220 };
    const result = computePopoverPlacement({
      target: { x: 100, y: 0, width: 200, height: 200 },
      scroll: { x: 0, y: 0 },
      viewport: tinyViewport,
      popover,
    });
    // Top must be clamped to padding (no negative values).
    expect(result.top).toBeGreaterThanOrEqual(POPOVER_EDGE_PADDING);
    expect(result.top).toBeLessThanOrEqual(
      Math.max(POPOVER_EDGE_PADDING, tinyViewport.height - popover.height - POPOVER_EDGE_PADDING)
    );
  });
});
