import { type Capture, pickerStore } from "@/lib/picker-store";
import { Badge, Button } from "@remarks/ui";
import { useState } from "react";

interface SidebarCapturePanelProps {
  capture: Capture;
}

export function SidebarCapturePanel({ capture }: SidebarCapturePanelProps) {
  if (capture.kind === "rect") return <RectCapturePanel capture={capture} />;
  return <ElementCapturePanel capture={capture} />;
}

function ElementCapturePanel({ capture }: { capture: Extract<Capture, { kind: "element" }> }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(capture.selector);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const handleRepick = () => {
    pickerStore.getState().enterElementMode();
  };

  const textPreview = capture.domContext.textContent?.trim();

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-2">
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="font-mono uppercase">
          {capture.domContext.tagName}
        </Badge>
        <span className="text-[11px] text-muted-foreground">via {capture.strategy}</span>
      </div>
      {textPreview ? (
        <p className="line-clamp-2 text-xs text-foreground/80" title={textPreview}>
          {textPreview}
        </p>
      ) : null}
      <code className="block break-all rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground">
        {capture.selector}
      </code>
      <div className="flex items-center justify-end gap-1.5">
        <Button variant="ghost" size="sm" onClick={handleRepick}>
          Re-pick
        </Button>
        <Button variant="outline" size="sm" onClick={handleCopy}>
          {copied ? "Copied" : "Copy selector"}
        </Button>
      </div>
    </div>
  );
}

function RectCapturePanel({ capture }: { capture: Extract<Capture, { kind: "rect" }> }) {
  const [copied, setCopied] = useState(false);
  const w = Math.round(capture.rect.width);
  const h = Math.round(capture.rect.height);
  const x = Math.round(capture.rect.x);
  const y = Math.round(capture.rect.y);
  const bounds = `${w}×${h} @ (${x}, ${y})`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(bounds);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const handleRepick = () => {
    pickerStore.getState().enterRectMode();
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-2">
      <div className="flex items-center gap-2">
        <Badge
          variant="secondary"
          className="border-amber-300 bg-amber-100 font-mono uppercase text-amber-900"
        >
          Rect
        </Badge>
        <span className="text-[11px] text-muted-foreground">document coords</span>
      </div>
      <code className="block rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground">
        {bounds}
      </code>
      <div className="flex items-center justify-end gap-1.5">
        <Button variant="ghost" size="sm" onClick={handleRepick}>
          Re-pick
        </Button>
        <Button variant="outline" size="sm" onClick={handleCopy}>
          {copied ? "Copied" : "Copy bounds"}
        </Button>
      </div>
    </div>
  );
}
