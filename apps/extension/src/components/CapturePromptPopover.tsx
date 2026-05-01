import type { DomContext } from "@/lib/dom-context";
import { type Capture, type ElementCapture, pickerStore, usePicker } from "@/lib/picker-store";
import { type DocRect, computePopoverPlacement } from "@/lib/popover-position";
import { sidebarStore, useSidebar } from "@/lib/sidebar-store";
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, cn } from "@remarks/ui";
import { ChevronDown } from "lucide-react";
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

function formatCrumb(tag: string | undefined, classes: readonly string[] | undefined): string {
  if (!tag) return "";
  const firstClass = classes?.[0];
  return firstClass ? `${tag}.${firstClass}` : tag;
}

function elementIdentifier(domContext: DomContext, fallback: string): string {
  const tag = domContext.tagName ?? "element";
  const classes = domContext.classes ?? [];
  if (classes.length === 0) return fallback;
  return `${tag}.${classes.slice(0, 2).join(".")}`;
}

function breadcrumbCrumbs(domContext: DomContext): string[] {
  const ancestors = (domContext.ancestors ?? []).slice().reverse();
  const crumbs = ancestors.map((a) => formatCrumb(a.tagName, a.classes)).filter(Boolean);
  const self = formatCrumb(domContext.tagName, domContext.classes);
  if (self) crumbs.push(self);
  return crumbs;
}

export function CapturePromptPopover({ onSubmit }: Props) {
  const capture = usePicker((s) => s.capture);
  const dismissed = usePicker((s) => s.popoverDismissed);
  const draft = useSidebar((s) => s.draftComment);

  const popoverRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const visible = Boolean(capture) && !dismissed;

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
    if (!visible) return;
    recompute();
  }, [recompute, visible]);

  // Re-position on scroll/resize. rAF-throttled so we don't thrash.
  useEffect(() => {
    if (!visible) return;
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
  }, [visible, recompute]);

  // Auto-focus the textarea when the popover becomes visible so the user can
  // start typing without an extra click. Re-runs when capture identity changes
  // (e.g., user re-picked a different element) or when they Resume after Esc.
  useEffect(() => {
    if (!visible) return;
    textareaRef.current?.focus();
  }, [visible]);

  // Esc hides the popover but preserves capture + draft so accidental Esc
  // doesn't destroy in-progress work — the sidebar's capture panel exposes a
  // Resume button to bring the popover back. Discard explicitly clears.
  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Only act when focus is inside the popover, otherwise picker-controller
      // may want to handle Escape itself (e.g., to cancel an active session).
      const path = event.composedPath();
      if (popoverRef.current && path.includes(popoverRef.current)) {
        event.preventDefault();
        pickerStore.getState().dismissPopover();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible]);

  if (!visible || !capture) return null;

  const canSubmit = draft.trim().length > 0;
  const ariaLabel =
    capture.kind === "element"
      ? `Annotate ${capture.domContext.tagName ?? "element"}`
      : "Annotate region";

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
      aria-label={ariaLabel}
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
      {capture.kind === "element" ? (
        <ElementHeader capture={capture} />
      ) : (
        <p className="text-xs font-medium text-muted-foreground">Annotate this region</p>
      )}
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

interface ElementHeaderProps {
  capture: ElementCapture;
}

function ElementHeader({ capture }: ElementHeaderProps) {
  const { domContext, selector } = capture;
  const identifier = elementIdentifier(domContext, selector);
  const crumbs = breadcrumbCrumbs(domContext);
  const computed = domContext.computedStyles;
  const hasComputed = computed && Object.keys(computed).length > 0;

  return (
    <Collapsible className="flex flex-col gap-1.5">
      <CollapsibleTrigger
        className={cn(
          "group flex w-full items-center justify-between gap-2 rounded-sm text-left",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          !hasComputed && "cursor-default"
        )}
        disabled={!hasComputed}
      >
        <span className="truncate font-mono text-xs font-medium text-foreground">{identifier}</span>
        {hasComputed ? (
          <ChevronDown
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
            aria-hidden
          />
        ) : null}
      </CollapsibleTrigger>
      {crumbs.length > 0 ? (
        <p className="break-words font-mono text-[11px] leading-snug text-muted-foreground">
          {crumbs.join(" › ")}
        </p>
      ) : null}
      {hasComputed ? (
        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-none">
          <dl className="mt-1 grid max-h-48 grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 overflow-y-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] leading-snug">
            {Object.entries(computed).map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-muted-foreground">{key}</dt>
                <dd className="truncate text-foreground" title={value}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}
