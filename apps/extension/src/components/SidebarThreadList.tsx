import { annotationStore, useAnnotationUi } from "@/lib/annotation-store";
import { useSidebar } from "@/lib/sidebar-store";
import {
  INTENT_DOT_CLASS,
  INTENT_LABEL,
  SEVERITY_DOT_CLASS,
  SEVERITY_LABEL,
  STATUS_DOT_CLASS,
  STATUS_LABEL,
  authorInitials,
  safeHostname,
} from "@/lib/status-ui";
import { trpc } from "@/lib/trpc";
import { useCurrentUrl } from "@/lib/use-current-url";
import type { AnnotationResponse } from "@remarks/shared";
import { Button, cn } from "@remarks/ui";
import { MessageSquarePlus } from "lucide-react";

const PAGE_SIZE = 50;

interface Props {
  // Null = personal mode (no project selected); list is the caller's accessible
  // annotations on this URL across personal + their member-projects.
  projectId: string | null;
  branch: string | null;
}

export function SidebarThreadList({ projectId, branch }: Props) {
  const url = useCurrentUrl();
  const statusFilter = useSidebar((s) => s.statusFilter);
  const intentFilter = useSidebar((s) => s.intentFilter);
  const severityFilter = useSidebar((s) => s.severityFilter);
  const status = statusFilter === "all" ? undefined : statusFilter;
  const intent = intentFilter === "all" ? undefined : intentFilter;
  const severity = severityFilter === "all" ? undefined : severityFilter;

  const projectQuery = trpc.annotations.list.useInfiniteQuery(
    {
      projectId: projectId ?? "",
      branch: branch ?? "",
      url,
      status,
      intent,
      severity,
      limit: PAGE_SIZE,
    },
    {
      enabled: projectId !== null && branch !== null,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      initialCursor: undefined,
    }
  );

  const userQuery = trpc.annotations.listForUser.useInfiniteQuery(
    { url, status, intent, severity, limit: PAGE_SIZE, scope: "all" },
    {
      enabled: projectId === null,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      initialCursor: undefined,
    }
  );

  const query = projectId !== null ? projectQuery : userQuery;

  if (query.isPending) {
    return <SidebarThreadListSkeleton />;
  }

  if (query.isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
        <p className="text-sm font-medium text-foreground">Couldn&apos;t load annotations</p>
        <p className="text-xs text-muted-foreground">{query.error.message}</p>
        <Button size="sm" variant="outline" onClick={() => query.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const items = query.data.pages.flatMap((p) => p.items);

  if (items.length === 0) {
    const anyFilter = status !== undefined || intent !== undefined || severity !== undefined;
    return <SidebarThreadListEmpty filtered={anyFilter} />;
  }

  return (
    <div className="flex flex-col gap-1.5 px-2 py-2">
      {items.map((item) => (
        <ThreadItem key={item.id} annotation={item} />
      ))}
      {query.hasNextPage ? (
        <div className="flex justify-center pt-1">
          <Button
            size="sm"
            variant="ghost"
            className="text-xs"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SidebarThreadListSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading annotations"
      className="flex flex-col gap-1.5 px-2 py-2"
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex animate-pulse items-start gap-2 rounded-md border border-border bg-muted/30 p-2"
        >
          <div className="h-7 w-7 shrink-0 rounded-full bg-muted" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 w-1/2 rounded bg-muted" />
            <div className="h-2.5 w-3/4 rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SidebarThreadListEmpty({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <MessageSquarePlus className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-foreground">
        {filtered ? "No matching annotations" : "No annotations on this page"}
      </p>
      <p className="text-xs text-muted-foreground">
        Press{" "}
        <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">C</kbd> to
        pick an element or{" "}
        <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">R</kbd> to
        draw a rectangle.
      </p>
    </div>
  );
}

interface ThreadItemProps {
  annotation: AnnotationResponse;
}

function ThreadItem({ annotation }: ThreadItemProps) {
  const screenshot = annotation.assets.find((a) => a.kind === "screenshot");
  const initials = authorInitials(annotation.author);
  const authorLabel = annotation.author.name ?? annotation.author.email ?? "Unknown";
  const hostname = safeHostname(annotation.url);
  const date = new Date(annotation.createdAt);
  const hovered = useAnnotationUi((s) => s.hoveredAnnotationId === annotation.id);

  const open = () => annotationStore.getState().setSelected(annotation.id);

  return (
    <button
      type="button"
      className={cn(
        "flex w-full cursor-pointer items-start gap-2 rounded-md border bg-card p-2 text-left text-card-foreground transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        hovered ? "border-primary bg-primary/5" : "border-border"
      )}
      data-remarks-thread-item={annotation.id}
      aria-label={`Open annotation by ${authorLabel}`}
      onMouseEnter={() => annotationStore.getState().setHovered(annotation.id)}
      onMouseLeave={() => annotationStore.getState().setHovered(null)}
      onClick={open}
    >
      {screenshot ? (
        <img
          src={screenshot.url}
          alt=""
          className="h-10 w-10 shrink-0 rounded-md border border-border object-cover"
        />
      ) : (
        <div
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[10px] font-medium text-foreground"
        >
          {initials}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            aria-hidden="true"
            className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT_CLASS[annotation.status])}
          />
          <span className="text-foreground">{STATUS_LABEL[annotation.status]}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{authorLabel}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={annotation.createdAt} title={date.toLocaleString()}>
            {date.toLocaleDateString()}
          </time>
        </div>
        {annotation.intent || annotation.severity ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            {annotation.severity ? (
              <span className="inline-flex items-center gap-1">
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    SEVERITY_DOT_CLASS[annotation.severity]
                  )}
                />
                <span>{SEVERITY_LABEL[annotation.severity]}</span>
              </span>
            ) : null}
            {annotation.intent ? (
              <span className="inline-flex items-center gap-1">
                <span
                  aria-hidden="true"
                  className={cn("h-1.5 w-1.5 rounded-full", INTENT_DOT_CLASS[annotation.intent])}
                />
                <span>{INTENT_LABEL[annotation.intent]}</span>
              </span>
            ) : null}
          </div>
        ) : null}
        <p className="mt-1 line-clamp-3 text-xs text-foreground">{annotation.commentText}</p>
        {hostname ? (
          <p className="mt-1 truncate text-[11px] text-muted-foreground">{hostname}</p>
        ) : null}
      </div>
    </button>
  );
}
