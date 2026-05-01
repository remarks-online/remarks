"use client";

import { AnnotationCard } from "@/components/annotations/annotation-card";
import { AnnotationDetailSheet } from "@/components/annotations/annotation-detail-sheet";
import {
  AnnotationFilters,
  type IntentFilter,
  type SeverityFilter,
  type StatusFilter,
} from "@/components/annotations/annotation-filters";
import { safeHostname } from "@/components/annotations/status-ui";
import { trpc } from "@/lib/trpc-client";
import {
  ANNOTATION_INTENTS,
  ANNOTATION_SEVERITIES,
  ANNOTATION_STATUSES,
  type AnnotationIntent,
  type AnnotationListResponse,
  type AnnotationResponse,
  type AnnotationSeverity,
} from "@remarks/shared";
import { Button } from "@remarks/ui";
import { MessageSquarePlus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

export const PERSONAL_PAGE_SIZE = 50;

interface PersonalAnnotationsBrowserProps {
  initialData: AnnotationListResponse;
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

export function PersonalAnnotationsBrowser({ initialData }: PersonalAnnotationsBrowserProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("a");
  const status = parseStatus(searchParams.get("status"));
  const intent = parseIntent(searchParams.get("intent"));
  const severity = parseSeverity(searchParams.get("severity"));

  const { data, hasNextPage, fetchNextPage, isFetchingNextPage, isError } =
    trpc.annotations.listForUser.useInfiniteQuery(
      {
        scope: "personal",
        limit: PERSONAL_PAGE_SIZE,
        ...(status !== "all" ? { status } : {}),
        ...(intent !== "all" ? { intent } : {}),
        ...(severity !== "all" ? { severity } : {}),
      },
      {
        ...(status === "all" && intent === "all" && severity === "all"
          ? { initialData: { pages: [initialData], pageParams: [undefined] } }
          : {}),
        initialCursor: undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        refetchInterval: 5000,
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

  const groups = groupByHost(items);

  const staleBanner = isError ? (
    <div
      aria-live="polite"
      className="mt-6 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
    >
      Couldn&apos;t refresh annotations — showing the last list we loaded.
    </div>
  ) : null;

  const filtersBar = (
    <div className="mt-6">
      <AnnotationFilters
        status={status}
        intent={intent}
        severity={severity}
        onStatusChange={(v) => setFilter("status", v)}
        onIntentChange={(v) => setFilter("intent", v)}
        onSeverityChange={(v) => setFilter("severity", v)}
      />
    </div>
  );

  if (items.length === 0) {
    return (
      <>
        {filtersBar}
        {staleBanner}
        <div className="mt-8 flex flex-col items-center rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <MessageSquarePlus className="h-7 w-7" aria-hidden />
          </div>
          <h2 className="mt-4 text-lg font-semibold">
            {filtersActive ? "No annotations match these filters" : "No personal annotations yet"}
          </h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            {filtersActive
              ? "Try clearing one of the filters above to widen the list."
              : "Use the Remarks browser extension to capture an annotation on any page. It'll land here as long as you don't pick a team project in the popup."}
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
          <HostSection
            key={group.host}
            host={group.host}
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

function groupByHost(
  items: AnnotationResponse[]
): Array<{ host: string; annotations: AnnotationResponse[] }> {
  const map = new Map<string, AnnotationResponse[]>();
  for (const item of items) {
    const key = safeHostname(item.url) ?? "(unknown)";
    const existing = map.get(key);
    if (existing) existing.push(item);
    else map.set(key, [item]);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([host, annotations]) => ({ host, annotations }));
}

function HostSection({
  host,
  annotations,
  selectedId,
  onSelect,
}: {
  host: string;
  annotations: AnnotationResponse[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between border-b border-border pb-2">
        <h2 className="text-lg font-semibold">
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm font-normal">
            {host}
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
