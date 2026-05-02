"use client";

import {
  type AnnotationIntent,
  type AnnotationResponse,
  type AnnotationSeverity,
  type AnnotationStatus,
  type MarkdownExportScope,
  renderAnnotationsMarkdown,
} from "@remarks/shared";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@remarks/ui";
import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export interface ExportAnnotationsMenuProps {
  items: AnnotationResponse[];
  hasNextPage: boolean;
  scope: MarkdownExportScope;
  filters: {
    status: AnnotationStatus | "all";
    intent: AnnotationIntent | "all";
    severity: AnnotationSeverity | "all";
  };
}

export function ExportAnnotationsMenu({
  items,
  hasNextPage,
  scope,
  filters,
}: ExportAnnotationsMenuProps) {
  const [busy, setBusy] = useState(false);

  const renderMarkdown = () =>
    renderAnnotationsMarkdown(items, {
      scope,
      dashboardOrigin: window.location.origin,
      filters,
    });

  const moreLoadedHint = hasNextPage
    ? `${items.length} loaded — click "Load more" before exporting to include the rest.`
    : undefined;

  const handleCopy = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await navigator.clipboard.writeText(renderMarkdown());
      const count = items.length;
      toast.success(`Copied ${count} annotation${count === 1 ? "" : "s"} as markdown`, {
        description: moreLoadedHint,
      });
    } catch (err) {
      toast.error("Couldn't copy to clipboard", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = () => {
    if (busy) return;
    setBusy(true);
    try {
      const md = renderMarkdown();
      const blob = new Blob([md], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameFor(scope);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const count = items.length;
      toast.success(`Downloaded ${count} annotation${count === 1 ? "" : "s"}`, {
        description: moreLoadedHint,
      });
    } catch (err) {
      toast.error("Couldn't download markdown", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || items.length === 0}
          aria-label="Export annotations as markdown"
        >
          <Download className="h-4 w-4" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={handleCopy} disabled={busy}>
          Copy as markdown
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleDownload} disabled={busy}>
          Download as .md
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function filenameFor(scope: MarkdownExportScope): string {
  const stamp = new Date().toISOString().slice(0, 10);
  if (scope.kind === "personal") return `remarks-personal-${stamp}.md`;
  const safe = scope.projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `remarks-${safe || "project"}-${stamp}.md`;
}
