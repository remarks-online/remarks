import { type Capture, pickerStore, usePicker } from "@/lib/picker-store";
import { type DocRect, computePopoverPlacement } from "@/lib/popover-position";
import { sidebarStore, useSidebar } from "@/lib/sidebar-store";
import { Button, cn } from "@remarks/ui";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const POPOVER_WIDTH = 320;
const POPOVER_FALLBACK_HEIGHT = 220;

interface Props {
  onSubmit: (text: string, capture: Capture) => void;
}

function targetDocRectFor(capture: Capture): DocRect {
  if (capture.kind === "element") {
    return capture.targetCoords;
  }
  return capture.rect;
}

export function CapturePromptPopover({ onSubmit }: Props) {
  const capture = usePicker((s) => s.capture);
  const draft = useSidebar((s) => s.draftComment);

  const popoverRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const recompute = useCallback(() => {
    if (!capture) return;
    const measured = popoverRef.current?.getBoundingClientRect();
    const popoverHeight = measured?.height ?? POPOVER_FALLBACK_HEIGHT;
    const placement = computePopoverPlacement({
      target: targetDocRectFor(capture),
      scroll: { x: window.scrollX, y: window.scrollY },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      popover: { width: POPOVER_WIDTH, height: popoverHeight },
    });
    setPosition({ top: placement.top, left: placement.left });
  }, [capture]);

  // Position synchronously after the first render so the popover paints in the
  // right spot — useLayoutEffect avoids a one-frame flash at (0, 0).
  useLayoutEffect(() => {
    recompute();
  }, [recompute]);

  // Re-position on scroll/resize. rAF-throttled so we don't thrash.
  useEffect(() => {
    if (!capture) return;
    let rafId: number | null = null;
    const schedule = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        recompute();
      });
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [capture, recompute]);

  // Auto-focus the textarea when a capture appears so the user can start
  // typing without an extra click. Re-runs when capture identity changes
  // (e.g., user re-picked a different element).
  useEffect(() => {
    if (!capture) return;
    textareaRef.current?.focus();
  }, [capture]);

  // Esc dismisses the popover (same as Discard).
  useEffect(() => {
    if (!capture) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Only act when focus is inside the popover, otherwise picker-controller
      // may want to handle Escape itself (e.g., to cancel an active session).
      const active = document.activeElement;
      if (active && popoverRef.current?.contains(active)) {
        event.preventDefault();
        handleDiscard();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capture]);

  if (!capture) return null;

  const canSubmit = draft.trim().length > 0;
  const caption = capture.kind === "element" ? "Annotate this element" : "Annotate this region";

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit(draft.trim(), capture);
  };

  function handleDiscard() {
    sidebarStore.getState().setDraftComment("");
    pickerStore.getState().clearCapture();
  }

  return (
    <div
      ref={popoverRef}
      aria-label={caption}
      className={cn(
        "pointer-events-auto fixed flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-foreground shadow-2xl",
        position ? "" : "invisible"
      )}
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        width: POPOVER_WIDTH,
        zIndex: 2147483647,
      }}
    >
      <p className="text-xs font-medium text-muted-foreground">{caption}</p>
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => sidebarStore.getState().setDraftComment(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder="Describe the issue with this selection…"
        rows={4}
        className={cn(
          "w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        )}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">⌘⏎ to post</p>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" onClick={handleDiscard}>
            Discard
          </Button>
          <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
            Post
          </Button>
        </div>
      </div>
    </div>
  );
}
