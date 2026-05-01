import { useShadowRootPortalContainer } from "@/lib/shadow-root-context";
import {
  type IntentFilter,
  type SeverityFilter,
  type StatusFilter,
  sidebarStore,
  useSidebar,
} from "@/lib/sidebar-store";
import {
  INTENT_DOT_CLASS,
  INTENT_LABEL,
  SEVERITY_DOT_CLASS,
  SEVERITY_LABEL,
  STATUS_DOT_CLASS,
  STATUS_LABEL,
} from "@/lib/status-ui";
import { ANNOTATION_INTENTS, ANNOTATION_SEVERITIES } from "@remarks/shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, cn } from "@remarks/ui";

interface OptionDef<TValue extends string> {
  value: TValue;
  label: string;
  dotClass: string | null;
}

const STATUS_OPTIONS: readonly OptionDef<StatusFilter>[] = [
  { value: "all", label: "All statuses", dotClass: null },
  { value: "to_do", label: STATUS_LABEL.to_do, dotClass: STATUS_DOT_CLASS.to_do },
  { value: "doing", label: STATUS_LABEL.doing, dotClass: STATUS_DOT_CLASS.doing },
  { value: "done", label: STATUS_LABEL.done, dotClass: STATUS_DOT_CLASS.done },
  { value: "rejected", label: STATUS_LABEL.rejected, dotClass: STATUS_DOT_CLASS.rejected },
  // ADR-0016 / G3: agents can reach this state; humans need to be able to
  // filter by it (e.g., "show me everything an agent has acked but not done").
  {
    value: "acknowledged",
    label: STATUS_LABEL.acknowledged,
    dotClass: STATUS_DOT_CLASS.acknowledged,
  },
] as const;

const INTENT_OPTIONS: readonly OptionDef<IntentFilter>[] = [
  { value: "all", label: "All intents", dotClass: null },
  ...ANNOTATION_INTENTS.map((i) => ({
    value: i,
    label: INTENT_LABEL[i],
    dotClass: INTENT_DOT_CLASS[i],
  })),
] as const;

const SEVERITY_OPTIONS: readonly OptionDef<SeverityFilter>[] = [
  { value: "all", label: "All severities", dotClass: null },
  ...ANNOTATION_SEVERITIES.map((s) => ({
    value: s,
    label: SEVERITY_LABEL[s],
    dotClass: SEVERITY_DOT_CLASS[s],
  })),
] as const;

interface DotItemProps<TValue extends string> {
  options: readonly OptionDef<TValue>[];
}

function dotOption<TValue extends string>(opt: OptionDef<TValue>) {
  return (
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
  );
}

function StatusSelect({ options }: DotItemProps<StatusFilter>) {
  const selected = useSidebar((s) => s.statusFilter);
  const container = useShadowRootPortalContainer();
  return (
    <Select
      value={selected}
      onValueChange={(v) => sidebarStore.getState().setStatusFilter(v as StatusFilter)}
    >
      <SelectTrigger aria-label="Filter annotations by status" className="h-8 w-full text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent container={container}>{options.map((opt) => dotOption(opt))}</SelectContent>
    </Select>
  );
}

function IntentSelect({ options }: DotItemProps<IntentFilter>) {
  const selected = useSidebar((s) => s.intentFilter);
  const container = useShadowRootPortalContainer();
  return (
    <Select
      value={selected}
      onValueChange={(v) => sidebarStore.getState().setIntentFilter(v as IntentFilter)}
    >
      <SelectTrigger aria-label="Filter annotations by intent" className="h-8 w-full text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent container={container}>{options.map((opt) => dotOption(opt))}</SelectContent>
    </Select>
  );
}

function SeveritySelect({ options }: DotItemProps<SeverityFilter>) {
  const selected = useSidebar((s) => s.severityFilter);
  const container = useShadowRootPortalContainer();
  return (
    <Select
      value={selected}
      onValueChange={(v) => sidebarStore.getState().setSeverityFilter(v as SeverityFilter)}
    >
      <SelectTrigger aria-label="Filter annotations by severity" className="h-8 w-full text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent container={container}>{options.map((opt) => dotOption(opt))}</SelectContent>
    </Select>
  );
}

/**
 * Status / Intent / Severity filter trio for the sidebar. Stacked vertically
 * because the panel is ≤520 px wide; cramming three selects into one row
 * truncates labels too aggressively.
 */
export function SidebarStatusTabs() {
  return (
    <div className="flex flex-col gap-1 border-b border-border px-1.5 py-1">
      <StatusSelect options={STATUS_OPTIONS} />
      <div className="flex gap-1">
        <div className="flex-1">
          <IntentSelect options={INTENT_OPTIONS} />
        </div>
        <div className="flex-1">
          <SeveritySelect options={SEVERITY_OPTIONS} />
        </div>
      </div>
    </div>
  );
}
