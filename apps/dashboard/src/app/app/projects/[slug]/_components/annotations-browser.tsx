"use client";

import { AnnotationCard } from "@/components/annotations/annotation-card";
import { AnnotationDetailSheet } from "@/components/annotations/annotation-detail-sheet";
import {
  AnnotationFilters,
  type IntentFilter,
  type SeverityFilter,
  type StatusFilter,
} from "@/components/annotations/annotation-filters";
import { ExportAnnotationsMenu } from "@/components/annotations/export-annotations-menu";
import { LiveIndicator } from "@/components/annotations/live-indicator";
import { useAnnotationStream } from "@/hooks/use-annotation-stream";
import { applyStreamEventToCache } from "@/lib/annotation-stream-cache";
import { trpc } from "@/lib/trpc-client";
import {
  ANNOTATION_INTENTS,
  ANNOTATION_SEVERITIES,
  ANNOTATION_STATUSES,
  type AnnotationIntent,
  type AnnotationListResponse,
  type AnnotationResponse,
  type AnnotationSeverity,
  type AnnotationStreamEvent,
} from "@remarks/shared";
import { Button } from "@remarks/ui";
import { MessageSquarePlus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { toast } from "sonner";

export const ANNOTATION_LIST_PAGE_SIZE = 50;

interface AnnotationsBrowserProps {
  projectId: string;
  projectName: string;
  initialData: AnnotationListResponse;
  primaryBranch: string;
}

function parseStatus(raw: string | null): StatusFilter {
  if (!raw) return "all";
  return (ANNOTATION_STATUSES as readonly string[]).includes(raw)
    ? (raw as AnnotationResponse["status"])
    : "all";
}

function parseIntent(raw: string | null): IntentFilter {
  if (!raw) return "all";
  return (ANNOTATION_INTENTS as readonly string[]).includes(raw)
    ? (raw as AnnotationIntent)
    : "all";
}

function parseSeverity(raw: string | null): SeverityFilter {
  if (!raw) return "all";
  return (ANNOTATION_SEVERITIES as readonly string[]).includes(raw)
    ? (raw as AnnotationSeverity)
    : "all";
}

export function AnnotationsBrowser({
  projectId,
  projectName,
  initialData,
  primaryBranch,
}: AnnotationsBrowserProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("a");
  const status = parseStatus(searchParams.get("status"));
  const intent = parseIntent(searchParams.get("intent"));
  const severity = parseSeverity(searchParams.get("severity"));

  const utils = trpc.useUtils();
  const currentUserQuery = trpc.me.getCurrentUser.useQuery(undefined, {
    staleTime: Number.POSITIVE_INFINITY,
  });
  const currentUserId = currentUserQuery.data?.user.id ?? null;

  const stream = useAnnotationStream({
    projectId,
    onEvent: useCallback(
      (event: AnnotationStreamEvent) => {
        void applyStreamEventToCache(event, {
          invalidateList: () => utils.annotations.list.invalidate(),
          invalidateAnnotation: (id) => utils.annotations.get.invalidate({ id }),
          invalidateAnnotationEvents: (id) => utils.annotations.listEvents.invalidate({ id }),
        });

        if (event.type === "created" && event.actorId !== currentUserId) {
          toast.info("New annotation", {
            description: "Someone just left feedback on this project.",
            action: {
              label: "View",
              onClick: () => {
                const params = new URLSearchParams(window.location.search);
                params.set("a", event.annotationId);
                router.replace(`${pathname}?${params.toString()}`, { scroll: false });
              },
            },
          });
        }
      },
      [utils, currentUserId, router, pathname]
    ),
    onTruncated: useCallback(() => {
      void utils.annotations.list.invalidate();
    }, [utils]),
  });

  // refetchInterval on useInfiniteQuery refetches every loaded page in order;
  // safe under (createdAt DESC, id DESC) keyset cursors — already-loaded pages
  // stay stable, new top items appear at the top. We only poll when the SSE
  // stream is not connected; otherwise the live feed handles updates.
  const { data, hasNextPage, fetchNextPage, isFetchingNextPage, isError } =
    trpc.annotations.list.useInfiniteQuery(
      {
        projectId,
        limit: ANNOTATION_LIST_PAGE_SIZE,
        ...(status !== "all" ? { status } : {}),
        ...(intent !== "all" ? { intent } : {}),
        ...(severity !== "all" ? { severity } : {}),
      },
      {
        // Cache hits are scoped to the input shape, so swapping filters resets
        // the cursor cleanly. The server-supplied initial page is only the
        // unfiltered list; reset to undefined so the first fetch matches the
        // active filter rather than re-using a mismatched seed.
        ...(status === "all" && intent === "all" && severity === "all"
          ? { initialData: { pages: [initialData], pageParams: [undefined] } }
          : {}),
        initialCursor: undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        refetchInterval: stream.status === "open" ? false : 5000,
        refetchIntervalInBackground: false,
      }
    );
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  const filtersActive = status !== "all" || intent !== "all" || severity !== "all";

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

  const setFilter = useCallback(
    (key: "status" | "intent" | "severity", value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === "all") params.delete(key);
      else params.set(key, value);
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

  const filtersBar = (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
      <AnnotationFilters
        status={status}
        intent={intent}
        severity={severity}
        onStatusChange={(v) => setFilter("status", v)}
        onIntentChange={(v) => setFilter("intent", v)}
        onSeverityChange={(v) => setFilter("severity", v)}
      />
      <div className="flex items-center gap-3">
        <ExportAnnotationsMenu
          items={items}
          hasNextPage={hasNextPage}
          scope={{ kind: "project", projectName, branchName: primaryBranch }}
          filters={{ status, intent, severity }}
        />
        <LiveIndicator status={stream.status} />
      </div>
    </div>
  );

  if (items.length === 0) {
    return (
      <>
        {filtersBar}
        {staleBanner}
        <div className="mt-12 flex flex-col items-center rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <MessageSquarePlus className="h-7 w-7" aria-hidden />
          </div>
          <h2 className="mt-4 text-lg font-semibold">
            {filtersActive ? "No annotations match these filters" : "No annotations yet"}
          </h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            {filtersActive
              ? "Try clearing one of the filters above to widen the list."
              : "Install the Remarks extension, open your site, and click any element to leave your first annotation on this project. New annotations appear here grouped by the branch you picked when you captured them."}
          </p>
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

  return (
    <>
      {filtersBar}
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
