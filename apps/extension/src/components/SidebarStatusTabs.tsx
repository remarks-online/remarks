import { type StatusFilter, sidebarStore, useSidebar } from "@/lib/sidebar-store";
import { STATUS_DOT_CLASS } from "@/lib/status-ui";
import { Badge, cn } from "@remarks/ui";

interface TabDef {
  id: Exclude<StatusFilter, "all">;
  label: string;
  shortLabel: string;
}

const TABS: readonly TabDef[] = [
  { id: "to_do", label: "To do", shortLabel: "Do" },
  { id: "doing", label: "Doing", shortLabel: "Wip" },
  { id: "done", label: "Done", shortLabel: "OK" },
  { id: "rejected", label: "Rejected", shortLabel: "No" },
] as const;

interface Props {
  counts?: Partial<Record<Exclude<StatusFilter, "all">, number>>;
  compact: boolean;
}

export function SidebarStatusTabs({ counts = {}, compact }: Props) {
  const selected = useSidebar((s) => s.statusFilter);

  return (
    <nav
      aria-label="Filter annotations by status"
      className="flex items-center gap-1 border-b border-border px-1.5 py-1"
    >
      <button
        type="button"
        onClick={() => sidebarStore.getState().setStatusFilter("all")}
        className={cn(
          "inline-flex items-center rounded-md px-2 py-1 text-xs font-medium transition-colors",
          selected === "all"
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/60"
        )}
      >
        All
      </button>
      {TABS.map((tab) => {
        const count = counts[tab.id] ?? 0;
        const active = selected === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => sidebarStore.getState().setStatusFilter(tab.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60"
            )}
            aria-pressed={active}
          >
            <span
              aria-hidden="true"
              className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT_CLASS[tab.id])}
            />
            <span>{compact ? tab.shortLabel : tab.label}</span>
            <Badge
              variant="secondary"
              className={cn("ml-1 h-4 min-w-4 px-1 text-[10px] tabular-nums", compact && "hidden")}
            >
              {count}
            </Badge>
          </button>
        );
      })}
    </nav>
  );
}
