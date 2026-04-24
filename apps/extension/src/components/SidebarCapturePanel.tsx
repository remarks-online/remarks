import { type Capture, pickerStore } from "@/lib/picker-store";
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
    <div className="rmk-capture">
      <div className="rmk-capture-summary">
        <span className="rmk-picker-tag-chip">{capture.domContext.tagName}</span>
        <span className="rmk-capture-strategy">via {capture.strategy}</span>
      </div>
      {textPreview ? (
        <p className="rmk-capture-text" title={textPreview}>
          {textPreview}
        </p>
      ) : null}
      <code className="rmk-picker-selector">{capture.selector}</code>
      <div className="rmk-capture-actions">
        <button type="button" className="rmk-btn" onClick={handleCopy}>
          {copied ? "Copied" : "Copy selector"}
        </button>
        <button type="button" className="rmk-btn rmk-btn-ghost" onClick={handleRepick}>
          Re-pick
        </button>
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
    <div className="rmk-capture">
      <div className="rmk-capture-summary">
        <span className="rmk-picker-tag-chip rmk-picker-tag-chip-rect">RECT</span>
        <span className="rmk-capture-strategy">document coords</span>
      </div>
      <code className="rmk-picker-selector">{bounds}</code>
      <div className="rmk-capture-actions">
        <button type="button" className="rmk-btn" onClick={handleCopy}>
          {copied ? "Copied" : "Copy bounds"}
        </button>
        <button type="button" className="rmk-btn rmk-btn-ghost" onClick={handleRepick}>
          Re-pick
        </button>
      </div>
    </div>
  );
}
