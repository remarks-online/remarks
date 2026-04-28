"use client";

import { AnnotationCard } from "@/components/annotations/annotation-card";
import { AnnotationDetailSheet } from "@/components/annotations/annotation-detail-sheet";
import { trpc } from "@/lib/trpc-client";
import type { AnnotationListResponse, AnnotationResponse } from "@remarks/shared";
import { Button } from "@remarks/ui";
import { MessageSquarePlus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

export const ANNOTATION_LIST_PAGE_SIZE = 50;

interface AnnotationsBrowserProps {
  projectId: string;
  initialData: AnnotationListResponse;
  primaryBranch: string;
}

export function AnnotationsBrowser({
  projectId,
  initialData,
  primaryBranch,
}: AnnotationsBrowserProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("a");

  // refetchInterval on useInfiniteQuery refetches every loaded page in order;
  // safe under (createdAt DESC, id DESC) keyset cursors — already-loaded pages
  // stay stable, new top items appear at the top.
  const { data, hasNextPage, fetchNextPage, isFetchingNextPage, isError } =
    trpc.annotations.list.useInfiniteQuery(
      { projectId, limit: ANNOTATION_LIST_PAGE_SIZE },
      {
        initialData: { pages: [initialData], pageParams: [undefined] },
        initialCursor: undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        refetchInterval: 5000,
        refetchIntervalInBackground: false,
      }
    );
  const items = data?.pages.flatMap((p) => p.items) ?? initialData.items;

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

  const staleBanner = isError ? (
    <div
      aria-live="polite"
      className="mt-6 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
    >
      Couldn&apos;t refresh annotations — showing the last list we loaded.
    </div>
  ) : null;

  if (items.length === 0) {
    return (
      <>
        {staleBanner}
        <div className="mt-12 flex flex-col items-center rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <MessageSquarePlus className="h-7 w-7" aria-hidden />
          </div>
          <h2 className="mt-4 text-lg font-semibold">No annotations yet</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Install the Remarks extension, open your site, and click any element to leave your first
            annotation on this project. New annotations appear here grouped by the branch you picked
            when you captured them.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      {staleBanner}
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
        {hasNextPage ? (
          <div className="flex justify-center pt-2">
            <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
              {isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </div>
        ) : null}
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
    // Project endpoints never return personal (null-branch) rows; fall back
    // defensively if one slips through so the UI doesn't crash.
    const key = item.branchName ?? primaryBranch;
    const existing = map.get(key);
    if (existing) existing.push(item);
    else map.set(key, [item]);
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
