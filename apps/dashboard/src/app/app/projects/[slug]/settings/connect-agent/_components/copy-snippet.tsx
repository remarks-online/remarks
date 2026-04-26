"use client";

import { Button } from "@remarks/ui";
import { useState } from "react";

interface Props {
  value: string;
  label?: string;
  // Render as a fenced block (multi-line config snippets) or inline with a
  // copy button on the right (one-line install commands).
  variant?: "block" | "inline";
}

export function CopySnippet({ value, label = "Copy", variant = "block" }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail in non-https / non-focused contexts. Fall
      // back to selecting the text so the user can hit Cmd+C themselves.
      // No alert / toast UI available; selection is the best we can do.
    }
  }

  if (variant === "inline") {
    return (
      <div className="flex items-stretch gap-2 rounded-md border bg-slate-50 px-3 py-2 font-mono text-sm">
        <code className="flex-1 overflow-x-auto whitespace-pre">{value}</code>
        <Button type="button" size="sm" variant="ghost" onClick={copy}>
          {copied ? "Copied" : label}
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md border bg-slate-50 p-3 font-mono text-xs leading-relaxed">
        {value}
      </pre>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="absolute right-2 top-2"
        onClick={copy}
      >
        {copied ? "Copied" : label}
      </Button>
    </div>
  );
}
