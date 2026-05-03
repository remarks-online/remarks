import { type PickerMode, pickerStore, usePicker } from "@/lib/picker-store";
import { sidebarStore, useSidebar } from "@/lib/sidebar-store";
import { Button, cn } from "@remarks/ui";
import { useEffect } from "react";

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
    return <ElementHint />;
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

// G17: element-mode hint adds a multi-select toggle + the running count once
// the user has accumulated selections. Single-element mode (toggle off, no
// pending selections) keeps the original message as the default.
function ElementHint() {
  const multiOn = usePicker((s) => s.multiSelectMode);
  const pendingCount = usePicker((s) => s.pendingSelections.length);
  const seenHint = useSidebar((s) => s.seenMultiSelectHint);

  // Mark the hint as seen the first time element-mode is opened. We don't
  // render a separate tooltip layer in V1 — the always-visible pill carries
  // the affordance, so "seen" just means "the user has been in element mode
  // once after this PR shipped." Suppresses any future first-run treatment we
  // bolt on (e.g., a tip-of-the-day banner).
  useEffect(() => {
    if (!seenHint) sidebarStore.getState().setSeenMultiSelectHint(true);
  }, [seenHint]);

  const onToggle = () => pickerStore.getState().setMultiSelectMode(!multiOn);
  const onDone = () => {
    const last = pickerStore.getState().pendingSelections.at(-1);
    if (last) pickerStore.getState().commitGroup(last);
  };

  return (
    <div className="flex flex-col gap-1.5 text-xs leading-relaxed text-muted-foreground">
      <div className="flex flex-wrap items-center gap-1.5">
        <span>Pick mode on. Hover any element, then click to capture.</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={multiOn}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
            multiOn
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-muted text-foreground hover:bg-muted/70"
          )}
        >
          Multi-select{multiOn && pendingCount > 0 ? ` · ${pendingCount}` : ""}
        </button>
        {pendingCount > 0 ? (
          <Button size="sm" className="h-6 px-2 text-[11px]" onClick={onDone}>
            Done ({pendingCount})
          </Button>
        ) : null}
      </div>
      <span className="text-[11px]">
        <Kbd>↑</Kbd>/<Kbd>↓</Kbd> walk · <Kbd>⌥</Kbd>+click to add · <Kbd>Enter</Kbd> finish ·
        <Kbd>Esc</Kbd> {pendingCount > 0 ? "clear" : "cancel"}
      </span>
    </div>
  );
}
