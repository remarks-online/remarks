const CARD_KEYS = ["c1", "c2", "c3"] as const;

export function AnnotationsPanelSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading annotations" className="mt-10 space-y-4">
      {CARD_KEYS.map((key) => (
        <div key={key} className="overflow-hidden rounded-xl border border-border bg-card p-4">
          <div className="flex gap-4">
            <div className="h-28 w-44 shrink-0 animate-pulse rounded-md bg-muted" />
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex gap-2">
                <div className="h-5 w-16 animate-pulse rounded bg-muted" />
                <div className="h-4 w-20 animate-pulse rounded bg-muted" />
              </div>
              <div className="space-y-2">
                <div className="h-3 w-full animate-pulse rounded bg-muted" />
                <div className="h-3 w-11/12 animate-pulse rounded bg-muted" />
                <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
              </div>
              <div className="h-3 w-40 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
