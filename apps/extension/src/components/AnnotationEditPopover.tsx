import { annotationStore, useAnnotationUi } from "@/lib/annotation-store";
import { computePopoverPlacement } from "@/lib/popover-position";
import { useShadowRootPortalContainer } from "@/lib/shadow-root-context";
import { INTENT_LABEL, SEVERITY_LABEL, STATUS_LABEL } from "@/lib/status-ui";
import { trpc } from "@/lib/trpc";
import {
  ANNOTATION_INTENTS,
  ANNOTATION_SEVERITIES,
  ANNOTATION_STATUSES,
  type AnnotationIntent,
  type AnnotationResponse,
  type AnnotationSeverity,
  type AnnotationStatus,
} from "@remarks/shared";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  cn,
} from "@remarks/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DomContextHeader } from "./DomContextHeader";

const POPOVER_WIDTH = 320;
const POPOVER_FALLBACK_HEIGHT = 240;

// Sentinel for the Select "Unset" item; the schema accepts null to clear.
const UNSET = "__unset__" as const;

interface ViewportState {
  scrollX: number;
  scrollY: number;
  innerWidth: number;
  innerHeight: number;
}

interface Props {
  // The cached list the parent already loaded. Avoids a duplicate fetch when
  // the popover opens.
  items: AnnotationResponse[];
  viewport: ViewportState;
}

export function AnnotationEditPopover({ items, viewport }: Props) {
  const selectedId = useAnnotationUi((s) => s.selectedAnnotationId);
  const portalContainer = useShadowRootPortalContainer();
  const queryClient = useQueryClient();

  const annotation = useMemo(
    () => (selectedId ? (items.find((i) => i.id === selectedId) ?? null) : null),
    [selectedId, items]
  );

  const [draft, setDraft] = useState<string>("");
  const [status, setStatus] = useState<AnnotationStatus>("to_do");
  const [intent, setIntent] = useState<AnnotationIntent | null>(null);
  const [severity, setSeverity] = useState<AnnotationSeverity | null>(null);

  // Reset the form whenever the selected annotation changes (open/swap).
  useEffect(() => {
    if (!annotation) return;
    setDraft(annotation.commentText);
    setStatus(annotation.status);
    setIntent(annotation.intent);
    setSeverity(annotation.severity);
  }, [annotation]);

  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const recompute = useCallback(() => {
    if (!annotation || !annotation.targetCoords) {
      setPosition(null);
      return;
    }
    const measured = popoverRef.current?.getBoundingClientRect();
    const popoverHeight = measured?.height ?? POPOVER_FALLBACK_HEIGHT;
    // Anchor to the pin tip (rect center), not the rect's bottom edge — for
    // tall elements (hero sections, banners) the rect can be hundreds of
    // pixels tall, and placing below the bottom drops the popover far below
    // the pin. A zero-size rect at the center keeps the popover snug to the
    // pin regardless of element size.
    const { x, y, width, height } = annotation.targetCoords;
    const pinTipRect = { x: x + width / 2, y: y + height / 2, width: 0, height: 0 };
    const placement = computePopoverPlacement({
      target: pinTipRect,
      scroll: { x: viewport.scrollX, y: viewport.scrollY },
      viewport: { width: viewport.innerWidth, height: viewport.innerHeight },
      popover: { width: POPOVER_WIDTH, height: popoverHeight },
    });
    setPosition({ top: placement.top, left: placement.left });
  }, [annotation, viewport]);

  useLayoutEffect(() => {
    if (!annotation) return;
    recompute();
  }, [annotation, recompute]);

  const updateMutation = trpc.annotations.update.useMutation({
    onSuccess: () => {
      // Mirror SidebarShell's invalidation key shape so both list keys
      // (project + user) refetch.
      void queryClient.invalidateQueries({ queryKey: [["annotations", "list"]] });
      void queryClient.invalidateQueries({ queryKey: [["annotations", "listForUser"]] });
      annotationStore.getState().setSelected(null);
    },
  });

  const close = useCallback(() => {
    annotationStore.getState().setSelected(null);
  }, []);

  // Escape closes the popover. Outside clicks close too — but we ignore clicks
  // landing on a pin button (those toggle selection via their own onClick).
  useEffect(() => {
    if (!annotation) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const path = event.composedPath();
      if (popoverRef.current && path.includes(popoverRef.current)) {
        event.preventDefault();
        close();
      }
    };
    const onMouseDown = (event: MouseEvent) => {
      if (!popoverRef.current) return;
      const path = event.composedPath();
      if (path.includes(popoverRef.current)) return;
      // Clicking another pin or another panel row should re-target, not close-then-open.
      const target = event.target as Element | null;
      if (target?.closest?.("[data-remarks-pin]")) return;
      if (target?.closest?.("[data-remarks-thread-item]")) return;
      close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onMouseDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onMouseDown, true);
    };
  }, [annotation, close]);

  if (!annotation) return null;

  const dirty =
    draft.trim().length > 0 &&
    (draft !== annotation.commentText ||
      status !== annotation.status ||
      intent !== annotation.intent ||
      severity !== annotation.severity);
  const canSubmit = dirty && draft.trim().length > 0 && !updateMutation.isPending;

  const screenshot = annotation.assets.find((a) => a.kind === "screenshot");

  const handleSubmit = () => {
    if (!canSubmit) return;
    const input: {
      commentText?: string;
      status?: AnnotationStatus;
      intent?: AnnotationIntent | null;
      severity?: AnnotationSeverity | null;
    } = {};
    if (draft !== annotation.commentText) input.commentText = draft.trim();
    if (status !== annotation.status) input.status = status;
    // intent / severity accept null to clear — send only when changed (else
    // `undefined` means no-op per ADR-0018).
    if (intent !== annotation.intent) input.intent = intent;
    if (severity !== annotation.severity) input.severity = severity;
    updateMutation.mutate({ id: annotation.id, input });
  };

  return (
    <div
      ref={popoverRef}
      aria-label="Edit annotation"
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
      {annotation.targetType === "element" && annotation.targetSelector ? (
        <DomContextHeader selector={annotation.targetSelector} domContext={annotation.domContext} />
      ) : null}
      {screenshot ? (
        <img
          src={screenshot.url}
          alt=""
          className="h-24 w-full rounded-md border border-border object-cover"
        />
      ) : null}
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder="Edit the annotation comment…"
        rows={3}
        className="resize-none"
      />
      <Select value={status} onValueChange={(v) => setStatus(v as AnnotationStatus)}>
        <SelectTrigger aria-label="Status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent container={popoverRef.current ?? portalContainer}>
          {ANNOTATION_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {STATUS_LABEL[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex gap-1.5">
        <Select
          value={intent ?? UNSET}
          onValueChange={(v) => setIntent(v === UNSET ? null : (v as AnnotationIntent))}
        >
          <SelectTrigger aria-label="Intent" className="flex-1">
            <SelectValue placeholder="Intent" />
          </SelectTrigger>
          <SelectContent container={popoverRef.current ?? portalContainer}>
            <SelectItem value={UNSET}>Uncategorized</SelectItem>
            {ANNOTATION_INTENTS.map((i) => (
              <SelectItem key={i} value={i}>
                {INTENT_LABEL[i]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={severity ?? UNSET}
          onValueChange={(v) => setSeverity(v === UNSET ? null : (v as AnnotationSeverity))}
        >
          <SelectTrigger aria-label="Severity" className="flex-1">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent container={popoverRef.current ?? portalContainer}>
            <SelectItem value={UNSET}>Uncategorized</SelectItem>
            {ANNOTATION_SEVERITIES.map((s) => (
              <SelectItem key={s} value={s}>
                {SEVERITY_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {updateMutation.isError ? (
        <p className="text-[11px] text-destructive">{updateMutation.error.message}</p>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">⌘⏎ to save</p>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" onClick={close} disabled={updateMutation.isPending}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
            {updateMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
