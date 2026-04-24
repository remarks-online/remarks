import type { PickerMode } from "@/lib/picker-store";

interface SidebarPickerHintProps {
  mode: PickerMode;
}

export function SidebarPickerHint({ mode }: SidebarPickerHintProps) {
  if (mode === "element") {
    return (
      <p className="rmk-picker-hint">
        Pick mode on. Hover any element on the page, then click to capture.
        <br />
        <span className="rmk-picker-hint-keys">
          <kbd>↑</kbd>/<kbd>↓</kbd> walk the tree · <kbd>Esc</kbd> to cancel
        </span>
      </p>
    );
  }

  if (mode === "rect") {
    return (
      <p className="rmk-picker-hint">
        Draw mode on. Click and drag to mark a region on the page.
        <br />
        <span className="rmk-picker-hint-keys">
          <kbd>Esc</kbd> or right-click to cancel
        </span>
      </p>
    );
  }

  return (
    <p className="rmk-picker-hint">
      Press <kbd>C</kbd> to pick an element · <kbd>R</kbd> to draw a rectangle.
    </p>
  );
}
