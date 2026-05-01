import { useShadowRootPortalContainer } from "@/lib/shadow-root-context";
import { type StatusFilter, sidebarStore, useSidebar } from "@/lib/sidebar-store";
import { STATUS_DOT_CLASS, STATUS_LABEL } from "@/lib/status-ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, cn } from "@remarks/ui";

interface OptionDef {
  value: StatusFilter;
  label: string;
  dotClass: string | null;
}

const OPTIONS: readonly OptionDef[] = [
  { value: "all", label: "All", dotClass: null },
  { value: "to_do", label: STATUS_LABEL.to_do, dotClass: STATUS_DOT_CLASS.to_do },
  { value: "doing", label: STATUS_LABEL.doing, dotClass: STATUS_DOT_CLASS.doing },
  { value: "done", label: STATUS_LABEL.done, dotClass: STATUS_DOT_CLASS.done },
  { value: "rejected", label: STATUS_LABEL.rejected, dotClass: STATUS_DOT_CLASS.rejected },
] as const;

export function SidebarStatusTabs() {
  const selected = useSidebar((s) => s.statusFilter);
  const container = useShadowRootPortalContainer();

  return (
    <div className="border-b border-border px-1.5 py-1">
      <Select
        value={selected}
        onValueChange={(v) => sidebarStore.getState().setStatusFilter(v as StatusFilter)}
      >
        <SelectTrigger aria-label="Filter annotations by status" className="h-8 w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent container={container}>
          {OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className="text-xs">
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    opt.dotClass ?? "bg-transparent ring-1 ring-border"
                  )}
                />
                {opt.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
