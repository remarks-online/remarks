import type { OutboxRecord } from "@/lib/outbox-db";
import * as outboxDb from "@/lib/outbox-db";
import { countsOf, outboxStore, useOutbox } from "@/lib/outbox-store";
import { triggerOutboxDrain } from "@/lib/use-outbox-drain";
import { Button, cn } from "@remarks/ui";
import { AlertTriangle, CloudUpload } from "lucide-react";

interface Props {
  apiUrl: string;
  token: string | null;
  clerkOrgId: string | null;
  compact: boolean;
}

function pluralize(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function SidebarOutboxBanner({ apiUrl, token, clerkOrgId, compact }: Props) {
  const items = useOutbox((s) => s.items);
  const counts = countsOf(items);

  if (counts.pending === 0 && counts.error === 0) return null;

  const handleRetryAll = async () => {
    const errored = outboxStore.getState().items.filter((r) => r.state === "error");
    await Promise.all(errored.map((r) => outboxDb.requeue(r.id)));
    // Immediate retry; hook's 30s tick would also catch this but users expect
    // instant feedback from a manual click.
    await triggerOutboxDrain({ apiUrl, token, clerkOrgId });
  };

  const handleDismissAll = async () => {
    const errored = outboxStore.getState().items.filter((r) => r.state === "error");
    await Promise.all(errored.map((r) => outboxDb.remove(r.id)));
    outboxStore.getState().hydrate(outboxStore.getState().items.filter((r) => r.state !== "error"));
  };

  return (
    <output
      aria-live="polite"
      className={cn(
        "flex items-center gap-2 border-t border-border px-2 py-1.5 text-[11px]",
        counts.error > 0
          ? "bg-destructive/10 text-destructive"
          : "bg-muted/60 text-muted-foreground"
      )}
    >
      {counts.error > 0 ? (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <CloudUpload className="h-3.5 w-3.5 shrink-0 animate-pulse" aria-hidden="true" />
      )}
      <div className="flex-1 truncate">
        {counts.pending > 0 ? (
          <span>
            {compact
              ? `Syncing ${counts.pending}`
              : `Syncing ${pluralize(counts.pending, "item", "items")}…`}
          </span>
        ) : null}
        {counts.pending > 0 && counts.error > 0 ? <span className="mx-1">·</span> : null}
        {counts.error > 0 ? (
          <span>
            {compact
              ? `${counts.error} failed`
              : `${pluralize(counts.error, "item", "items")} failed`}
          </span>
        ) : null}
        {!compact && counts.error > 0 ? (
          <ErrorDetail records={items.filter((r) => r.state === "error")} />
        ) : null}
      </div>
      {counts.error > 0 ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => void handleRetryAll()}
          >
            Retry
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => void handleDismissAll()}
          >
            Dismiss
          </Button>
        </div>
      ) : null}
    </output>
  );
}

function ErrorDetail({ records }: { records: OutboxRecord[] }) {
  const first = records[0];
  if (!first?.lastError) return null;
  return (
    <span className="ml-1 text-[11px] opacity-80">
      {" — "}
      {first.lastError.step}: {first.lastError.message}
    </span>
  );
}
