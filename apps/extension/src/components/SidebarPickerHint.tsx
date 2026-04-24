interface SidebarPickerHintProps {
  active: boolean;
}

export function SidebarPickerHint({ active }: SidebarPickerHintProps) {
  if (active) {
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

  return (
    <p className="rmk-picker-hint">
      Press <kbd>C</kbd> to pick an element on this page.
    </p>
  );
}
