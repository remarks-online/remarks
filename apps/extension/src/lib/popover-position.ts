export type Placement = "below" | "above";

export interface DocRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportRect {
  width: number;
  height: number;
}

export interface ScrollOffset {
  x: number;
  y: number;
}

export interface PopoverSize {
  width: number;
  height: number;
}

export interface PopoverPlacement {
  top: number;
  left: number;
  placement: Placement;
}

export const POPOVER_GAP = 8;
export const POPOVER_EDGE_PADDING = 8;

/**
 * Compute viewport-coord top/left for a popover anchored to a captured target.
 * Targets are in document coords (page); we subtract scroll for `position: fixed`
 * placement and clamp to the viewport so the popover never overflows.
 *
 * Placement preference is "below"; we flip to "above" when below would clip the
 * popover off the bottom edge AND there's room above. If neither side fits,
 * we keep "below" and clamp — partial visibility beats off-screen.
 */
export function computePopoverPlacement(args: {
  target: DocRect;
  scroll: ScrollOffset;
  viewport: ViewportRect;
  popover: PopoverSize;
}): PopoverPlacement {
  const { target, scroll, viewport, popover } = args;

  // Target in viewport coords.
  const targetTop = target.y - scroll.y;
  const targetLeft = target.x - scroll.x;
  const targetBottom = targetTop + target.height;

  const spaceBelow = viewport.height - targetBottom - POPOVER_GAP;
  const spaceAbove = targetTop - POPOVER_GAP;

  const fitsBelow = spaceBelow >= popover.height;
  const fitsAbove = spaceAbove >= popover.height;

  let placement: Placement;
  if (fitsBelow) placement = "below";
  else if (fitsAbove) placement = "above";
  else placement = spaceBelow >= spaceAbove ? "below" : "above";

  const top =
    placement === "below" ? targetBottom + POPOVER_GAP : targetTop - popover.height - POPOVER_GAP;

  // Horizontally align to the target's left edge by default, then clamp so
  // the popover never overflows past the viewport edges (with a small pad).
  const desiredLeft = targetLeft;
  const minLeft = POPOVER_EDGE_PADDING;
  const maxLeft = viewport.width - popover.width - POPOVER_EDGE_PADDING;
  const left = Math.max(minLeft, Math.min(desiredLeft, Math.max(minLeft, maxLeft)));

  // Vertically clamp too, so an oversized popover near a viewport edge is
  // still partially visible rather than placed off-screen.
  const minTop = POPOVER_EDGE_PADDING;
  const maxTop = viewport.height - popover.height - POPOVER_EDGE_PADDING;
  const clampedTop = Math.max(minTop, Math.min(top, Math.max(minTop, maxTop)));

  return { top: clampedTop, left, placement };
}
