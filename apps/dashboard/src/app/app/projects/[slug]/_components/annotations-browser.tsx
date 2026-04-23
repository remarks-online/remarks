"use client";

import type { AnnotationResponse } from "@remarks/shared";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { AnnotationCard } from "./annotation-card";
import { AnnotationDetailSheet } from "./annotation-detail-sheet";

interface AnnotationsBrowserProps {
  items: AnnotationResponse[];
  primaryBranch: string;
}

export function AnnotationsBrowser({ items, primaryBranch }: AnnotationsBrowserProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("a");

  const setSelected = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id) params.set("a", id);
      else params.delete("a");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const groups = groupByBranch(items, primaryBranch);

  if (items.length === 0) {
    return (
      <div className="mt-12 rounded-md border border-dashed border-border p-10 text-center">
        <p className="font-medium">No annotations yet</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Install the Remarks extension to start capturing annotations on this project.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mt-10 space-y-10">
        {groups.map((group) => (
          <BranchSection
            key={group.branchName}
            branchName={group.branchName}
            annotations={group.annotations}
            selectedId={selectedId}
            onSelect={setSelected}
          />
        ))}
      </div>
      <AnnotationDetailSheet
        selectedId={selectedId}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </>
  );
}

function groupByBranch(
  items: AnnotationResponse[],
  primaryBranch: string
): Array<{ branchName: string; annotations: AnnotationResponse[] }> {
  const map = new Map<string, AnnotationResponse[]>();
  for (const item of items) {
    const existing = map.get(item.branchName);
    if (existing) existing.push(item);
    else map.set(item.branchName, [item]);
  }
  const entries = Array.from(map.entries());
  entries.sort(([a], [b]) => {
    if (a === primaryBranch) return -1;
    if (b === primaryBranch) return 1;
    return a.localeCompare(b);
  });
  return entries.map(([branchName, annotations]) => ({ branchName, annotations }));
}

function BranchSection({
  branchName,
  annotations,
  selectedId,
  onSelect,
}: {
  branchName: string;
  annotations: AnnotationResponse[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between border-b border-border pb-2">
        <h2 className="text-lg font-semibold">
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm font-normal">
            {branchName}
          </code>
        </h2>
        <p className="text-xs text-muted-foreground">
          {annotations.length} annotation{annotations.length === 1 ? "" : "s"}
        </p>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4">
        {annotations.map((annotation) => (
          <AnnotationCard
            key={annotation.id}
            annotation={annotation}
            isSelected={annotation.id === selectedId}
            onSelect={() => onSelect(annotation.id)}
          />
        ))}
      </div>
    </div>
  );
}
