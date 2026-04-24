import { type Capture, pickerStore } from "@/lib/picker-store";
import { useState } from "react";

interface SidebarCapturePanelProps {
  capture: Capture;
}

export function SidebarCapturePanel({ capture }: SidebarCapturePanelProps) {
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
