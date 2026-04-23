"use client";

import { trpc } from "@/lib/trpc-client";
import type { AnnotationResponse } from "@remarks/shared";
import {
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetTitle,
} from "@remarks/ui";
import { useRouter } from "next/navigation";
import { EventRow } from "./event-row";
import { STATUS_LABEL, STATUS_OPTIONS, STATUS_VARIANT, safeHostname } from "./status-ui";

interface AnnotationDetailSheetProps {
  selectedId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function AnnotationDetailSheet({ selectedId, onOpenChange }: AnnotationDetailSheetProps) {
  const isOpen = selectedId !== null;

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-xl"
        aria-describedby={undefined}
      >
        {/* Radix requires a Title for every open Dialog. Keep one rendered */}
        {/* even during the loading state; the visible heading below replaces */}
        {/* it semantically once the detail hydrates. */}
        <SheetTitle className="sr-only">Annotation detail</SheetTitle>
        {selectedId ? <DetailBody id={selectedId} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({ id }: { id: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const annotationQuery = trpc.annotations.get.useQuery({ id });
  const eventsQuery = trpc.annotations.listEvents.useQuery({ id });

  const updateMutation = trpc.annotations.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.annotations.get.invalidate({ id }),
        utils.annotations.listEvents.invalidate({ id }),
        utils.annotations.list.invalidate(),
      ]);
      router.refresh();
    },
  });

  if (annotationQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (annotationQuery.isError || !annotationQuery.data) {
    return (
      <div className="space-y-2 text-sm">
        <p className="font-medium text-destructive">Failed to load annotation</p>
        <p className="text-muted-foreground">{annotationQuery.error?.message ?? "Unknown error"}</p>
      </div>
    );
  }

  const annotation = annotationQuery.data;
  const screenshot = annotation.assets.find((a) => a.kind === "screenshot");
  const hostname = safeHostname(annotation.url);

  return (
    <div className="flex h-full flex-col gap-6">
      <header className="flex flex-col gap-2 pr-10">
        <div className="flex flex-wrap items-center gap-2 text-lg font-semibold">
          <Badge variant={STATUS_VARIANT[annotation.status]}>
            {STATUS_LABEL[annotation.status]}
          </Badge>
          <span className="text-sm font-normal text-muted-foreground">{annotation.targetType}</span>
        </div>
        <p className="truncate text-sm text-muted-foreground">
          <a
            href={annotation.url}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            {hostname ?? annotation.url}
          </a>
        </p>
      </header>

      <section>
        <h3 className="sr-only">Comment</h3>
        <p className="whitespace-pre-wrap text-sm">{annotation.commentText}</p>
      </section>

      {screenshot ? (
        <section>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Screenshot
          </h3>
          <div className="mt-2 overflow-hidden rounded-md border border-border bg-muted">
            <img src={screenshot.url} alt="" className="w-full" />
          </div>
        </section>
      ) : null}

      <MetadataPanel annotation={annotation} />

      <section>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Status
          </h3>
          {updateMutation.isPending ? (
            <span className="text-xs text-muted-foreground">saving…</span>
          ) : updateMutation.isError ? (
            <span className="text-xs text-destructive">{updateMutation.error.message}</span>
          ) : null}
        </div>
        <div className="mt-2">
          <Select
            value={annotation.status}
            onValueChange={(value) => {
              if (value === annotation.status) return;
              updateMutation.mutate({
                id,
                input: { status: value as AnnotationResponse["status"] },
              });
            }}
            disabled={updateMutation.isPending}
          >
            <SelectTrigger aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Activity
        </h3>
        {eventsQuery.isPending ? (
          <p className="mt-2 text-sm text-muted-foreground">Loading activity…</p>
        ) : eventsQuery.isError ? (
          <p className="mt-2 text-sm text-destructive">
            {eventsQuery.error?.message ?? "Failed to load activity"}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {eventsQuery.data.events.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MetadataPanel({ annotation }: { annotation: AnnotationResponse }) {
  const authorLabel = annotation.author.name ?? annotation.author.email ?? "Unknown";
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
      <dt className="text-muted-foreground">Branch</dt>
      <dd>
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{annotation.branchName}</code>
      </dd>
      <dt className="text-muted-foreground">URL</dt>
      <dd className="truncate">
        <a
          href={annotation.url}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          {annotation.url}
        </a>
      </dd>
      {annotation.targetSelector ? (
        <>
          <dt className="text-muted-foreground">Selector</dt>
          <dd>
            <code className="block overflow-x-auto rounded bg-muted px-1.5 py-0.5 font-mono">
              {annotation.targetSelector}
            </code>
          </dd>
        </>
      ) : null}
      <dt className="text-muted-foreground">Viewport</dt>
      <dd>
        {annotation.viewport.width}×{annotation.viewport.height} @ {annotation.viewport.dpr}×
      </dd>
      <dt className="text-muted-foreground">Author</dt>
      <dd>{authorLabel}</dd>
      <dt className="text-muted-foreground">Created</dt>
      <dd>{new Date(annotation.createdAt).toLocaleString()}</dd>
      {annotation.updatedAt !== annotation.createdAt ? (
        <>
          <dt className="text-muted-foreground">Updated</dt>
          <dd>{new Date(annotation.updatedAt).toLocaleString()}</dd>
        </>
      ) : null}
    </dl>
  );
}
