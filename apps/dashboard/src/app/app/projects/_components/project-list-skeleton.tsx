const ROW_KEYS = ["r1", "r2", "r3", "r4", "r5"] as const;

export function ProjectListSkeleton() {
  return (
    <ul
      aria-busy="true"
      aria-label="Loading projects"
      className="mt-4 divide-y divide-border rounded-md border border-border"
    >
      {ROW_KEYS.map((key) => (
        <li key={key} className="flex items-center justify-between px-4 py-3">
          <div className="flex w-full flex-col gap-2">
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
            <div className="h-3 w-32 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        </li>
      ))}
    </ul>
  );
}
