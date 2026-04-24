import { SidebarCapturePanel } from "@/components/SidebarCapturePanel";
import { type Capture, pickerStore } from "@/lib/picker-store";
import { sidebarStore, useSidebar } from "@/lib/sidebar-store";
import { Button, cn } from "@remarks/ui";
import { forwardRef, useImperativeHandle, useRef } from "react";

export interface SidebarComposeBoxHandle {
  focus: () => void;
}

interface Props {
  capture: Capture | null;
  // Optional submit wiring; task 1.27 plugs this in. Until then the button is
  // disabled unless a handler is supplied.
  onSubmit?: (text: string, capture: Capture | null) => void;
}

export const SidebarComposeBox = forwardRef<SidebarComposeBoxHandle, Props>(
  ({ capture, onSubmit }, ref) => {
    const draft = useSidebar((s) => s.draftComment);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
    }));

    const canSubmit = draft.trim().length > 0 && Boolean(onSubmit);

    const handleSubmit = () => {
      if (!onSubmit || !canSubmit) return;
      onSubmit(draft.trim(), capture);
    };

    const handleClearCapture = () => {
      pickerStore.getState().clearCapture();
    };

    return (
      <div className="flex flex-col gap-2 border-t border-border bg-card p-2">
        {capture ? <SidebarCapturePanel capture={capture} /> : null}
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
          placeholder={
            capture
              ? "Describe the issue with this selection…"
              : "Pick an element or draw a rectangle to start, then comment here."
          }
          rows={3}
          className={cn(
            "w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          )}
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            {capture ? "Tip: ⌘⏎ to post." : "Press F to focus this box once you have a capture."}
          </p>
          <div className="flex gap-1.5">
            {capture ? (
              <Button variant="ghost" size="sm" onClick={handleClearCapture}>
                Clear capture
              </Button>
            ) : null}
            <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
              Post
            </Button>
          </div>
        </div>
      </div>
    );
  }
);
SidebarComposeBox.displayName = "SidebarComposeBox";
