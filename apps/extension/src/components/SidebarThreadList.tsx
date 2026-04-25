import { useSidebar } from "@/lib/sidebar-store";
import { STATUS_DOT_CLASS, STATUS_LABEL, authorInitials, safeHostname } from "@/lib/status-ui";
import { trpc } from "@/lib/trpc";
import { useCurrentUrl } from "@/lib/use-current-url";
import type { AnnotationResponse } from "@remarks/shared";
import { Button, cn } from "@remarks/ui";
import { MessageSquarePlus } from "lucide-react";

const PAGE_SIZE = 50;

interface Props {
  projectId: string;
  branch: string;
}

export function SidebarThreadList({ projectId, branch }: Props) {
  const url = useCurrentUrl();
  const statusFilter = useSidebar((s) => s.statusFilter);
  const compact = useSidebar((s) => s.compact);
  const status = statusFilter === "all" ? undefined : statusFilter;

  const query = trpc.annotations.list.useInfiniteQuery(
    { projectId, branch, url, status, limit: PAGE_SIZE },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      initialCursor: undefined,
      enabled: url.length > 0,
    }
  );

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
    return <SidebarThreadListEmpty filtered={status !== undefined} />;
  }

  return (
    <div className="flex flex-col gap-1.5 px-2 py-2">
      {items.map((item) => (
        <ThreadItem key={item.id} annotation={item} compact={compact} />
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
  compact: boolean;
}

function ThreadItem({ annotation, compact }: ThreadItemProps) {
  const screenshot = annotation.assets.find((a) => a.kind === "screenshot");
  const initials = authorInitials(annotation.author);
  const authorLabel = annotation.author.name ?? annotation.author.email ?? "Unknown";
  const hostname = safeHostname(annotation.url);
  const date = new Date(annotation.createdAt);

  return (
    <article
      className="flex items-start gap-2 rounded-md border border-border bg-card p-2 text-card-foreground"
      aria-label={`Annotation by ${authorLabel}`}
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
        <p
          className={cn("mt-1 text-xs text-foreground", compact ? "line-clamp-2" : "line-clamp-3")}
        >
          {annotation.commentText}
        </p>
        {hostname && !compact ? (
          <p className="mt-1 truncate text-[11px] text-muted-foreground">{hostname}</p>
        ) : null}
      </div>
    </article>
  );
}
