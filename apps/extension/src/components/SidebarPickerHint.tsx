import type { PickerMode } from "@/lib/picker-store";

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-0.5 inline-flex min-w-[1.25rem] justify-center rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground">
      {children}
    </kbd>
  );
}

interface SidebarPickerHintProps {
  mode: PickerMode;
}

export function SidebarPickerHint({ mode }: SidebarPickerHintProps) {
  if (mode === "element") {
    return (
      <p className="text-xs leading-relaxed text-muted-foreground">
        Pick mode on. Hover any element on the page, then click to capture.
        <br />
        <span className="mt-1 inline-block text-[11px]">
          <Kbd>↑</Kbd>/<Kbd>↓</Kbd> walk the tree · <Kbd>Esc</Kbd> cancel
        </span>
      </p>
    );
  }

  if (mode === "rect") {
    return (
      <p className="text-xs leading-relaxed text-muted-foreground">
        Draw mode on. Click and drag to mark a region on the page.
        <br />
        <span className="mt-1 inline-block text-[11px]">
          <Kbd>Esc</Kbd> or right-click to cancel
        </span>
      </p>
    );
  }

  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      <Kbd>⌘⇧E</Kbd> pick an element · <Kbd>⌘⇧X</Kbd> draw a rectangle.
    </p>
  );
}
