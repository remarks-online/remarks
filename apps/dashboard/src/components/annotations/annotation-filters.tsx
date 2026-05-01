"use client";

import {
  INTENT_FILTER_OPTIONS,
  SEVERITY_FILTER_OPTIONS,
  STATUS_FILTER_OPTIONS,
} from "@/components/annotations/status-ui";
import type { AnnotationIntent, AnnotationResponse, AnnotationSeverity } from "@remarks/shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@remarks/ui";

export type StatusFilter = AnnotationResponse["status"] | "all";
export type IntentFilter = AnnotationIntent | "all";
export type SeverityFilter = AnnotationSeverity | "all";

export interface AnnotationFiltersProps {
  status: StatusFilter;
  intent: IntentFilter;
  severity: SeverityFilter;
  onStatusChange: (next: StatusFilter) => void;
  onIntentChange: (next: IntentFilter) => void;
  onSeverityChange: (next: SeverityFilter) => void;
}

/**
 * Three-axis filter toolbar used by the project + personal annotation
 * browsers. Filter state is owned by the caller (typically URL search params)
 * so deep-links and back/forward navigation Just Work.
 */
export function AnnotationFilters({
  status,
  intent,
  severity,
  onStatusChange,
  onIntentChange,
  onSeverityChange,
}: AnnotationFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={status} onValueChange={(v) => onStatusChange(v as StatusFilter)}>
        <SelectTrigger aria-label="Filter by status" className="h-9 w-[160px] text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_FILTER_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={intent} onValueChange={(v) => onIntentChange(v as IntentFilter)}>
        <SelectTrigger aria-label="Filter by intent" className="h-9 w-[160px] text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {INTENT_FILTER_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={severity} onValueChange={(v) => onSeverityChange(v as SeverityFilter)}>
        <SelectTrigger aria-label="Filter by severity" className="h-9 w-[160px] text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SEVERITY_FILTER_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
