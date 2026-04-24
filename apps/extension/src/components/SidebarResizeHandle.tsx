import { type Dock, clampHeight, clampWidth, sidebarStore, useSidebar } from "@/lib/sidebar-store";
import { cn } from "@remarks/ui";
import { useRef } from "react";

interface ComputeArgs {
  dock: Dock;
  startWidth: number;
  startHeight: number;
  deltaX: number;
  deltaY: number;
}

/**
 * Pure helper: returns the clamped next size given the dock and a pointer
 * delta from the drag-start position. Exported for unit testing.
 *
 * - right dock: inner edge is on the LEFT. Pointer moving left grows width.
 * - left dock:  inner edge is on the RIGHT. Pointer moving right grows width.
 * - bottom dock: inner edge is on the TOP. Pointer moving up grows height.
 */
export function computeNextSize({ dock, startWidth, startHeight, deltaX, deltaY }: ComputeArgs): {
  width: number;
  height: number;
} {
  if (dock === "right") {
    return { width: clampWidth(startWidth - deltaX), height: startHeight };
  }
  if (dock === "left") {
    return { width: clampWidth(startWidth + deltaX), height: startHeight };
  }
  return { width: startWidth, height: clampHeight(startHeight - deltaY) };
}

export function SidebarResizeHandle() {
  const dock = useSidebar((s) => s.dock);
  const width = useSidebar((s) => s.width);
  const height = useSidebar((s) => s.height);
  const origin = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    origin.current = { x: event.clientX, y: event.clientY, width, height };
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);

    const onMove = (e: PointerEvent) => {
      if (!origin.current) return;
      const next = computeNextSize({
        dock,
        startWidth: origin.current.width,
        startHeight: origin.current.height,
        deltaX: e.clientX - origin.current.x,
        deltaY: e.clientY - origin.current.y,
      });
      sidebarStore.getState().setWidth(next.width);
      sidebarStore.getState().setHeight(next.height);
    };

    const onUp = (e: PointerEvent) => {
      origin.current = null;
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    };

    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };

  const isVertical = dock === "right" || dock === "left";
  const position =
    dock === "right"
      ? "left-0 top-0 h-full w-1 cursor-ew-resize"
      : dock === "left"
        ? "right-0 top-0 h-full w-1 cursor-ew-resize"
        : "left-0 top-0 h-1 w-full cursor-ns-resize";

  return (
    <div
      role="separator"
      aria-orientation={isVertical ? "vertical" : "horizontal"}
      aria-label="Resize sidebar"
      tabIndex={0}
      onPointerDown={onPointerDown}
      className={cn("absolute z-10 bg-transparent transition-colors hover:bg-primary/20", position)}
    />
  );
}
