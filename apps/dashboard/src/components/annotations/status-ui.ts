import {
  ANNOTATION_INTENTS,
  ANNOTATION_SEVERITIES,
  ANNOTATION_STATUSES,
  type AnnotationIntent,
  type AnnotationResponse,
  type AnnotationSeverity,
} from "@remarks/shared";
import type { BadgeProps } from "@remarks/ui";

export const STATUS_VARIANT: Record<
  AnnotationResponse["status"],
  NonNullable<BadgeProps["variant"]>
> = {
  to_do: "outline",
  doing: "default",
  done: "secondary",
  rejected: "destructive",
  acknowledged: "outline",
};

export const STATUS_LABEL: Record<AnnotationResponse["status"], string> = {
  to_do: "To do",
  doing: "In progress",
  done: "Done",
  rejected: "Rejected",
  acknowledged: "Acknowledged",
};

// `acknowledged` (G3 / ADR-0016) is agent-set; the human-facing status picker
// keeps the original four values so reviewers don't move tasks into a state
// that's only meaningful for agents.
export const STATUS_OPTIONS: ReadonlyArray<{
  value: AnnotationResponse["status"];
  label: string;
}> = [
  { value: "to_do", label: STATUS_LABEL.to_do },
  { value: "doing", label: STATUS_LABEL.doing },
  { value: "done", label: STATUS_LABEL.done },
  { value: "rejected", label: STATUS_LABEL.rejected },
];

// Filter dropdowns include `acknowledged` even though setters don't — agents
// may have acknowledged tasks the user wants to find.
export const STATUS_FILTER_OPTIONS: ReadonlyArray<{
  value: "all" | AnnotationResponse["status"];
  label: string;
}> = [
  { value: "all", label: "All statuses" },
  ...ANNOTATION_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
];

// G1: action-shape classifier. Variants chosen so `fix` (most likely to need
// attention) reads as urgent and `approve` reads as positive without leaning
// on a custom variant.
export const INTENT_VARIANT: Record<AnnotationIntent, NonNullable<BadgeProps["variant"]>> = {
  fix: "destructive",
  change: "default",
  question: "secondary",
  approve: "outline",
};

export const INTENT_LABEL: Record<AnnotationIntent, string> = {
  fix: "Fix",
  change: "Change",
  question: "Question",
  approve: "Approve",
};

export const INTENT_OPTIONS: ReadonlyArray<{ value: AnnotationIntent; label: string }> =
  ANNOTATION_INTENTS.map((i) => ({ value: i, label: INTENT_LABEL[i] }));

export const INTENT_FILTER_OPTIONS: ReadonlyArray<{
  value: "all" | AnnotationIntent;
  label: string;
}> = [{ value: "all", label: "All intents" }, ...INTENT_OPTIONS];

// G2: triage-by-priority. `blocking` reads urgent, `important` neutral-loud,
// `suggestion` muted.
export const SEVERITY_VARIANT: Record<AnnotationSeverity, NonNullable<BadgeProps["variant"]>> = {
  blocking: "destructive",
  important: "default",
  suggestion: "outline",
};

export const SEVERITY_LABEL: Record<AnnotationSeverity, string> = {
  blocking: "Blocking",
  important: "Important",
  suggestion: "Suggestion",
};

export const SEVERITY_OPTIONS: ReadonlyArray<{ value: AnnotationSeverity; label: string }> =
  ANNOTATION_SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABEL[s] }));

export const SEVERITY_FILTER_OPTIONS: ReadonlyArray<{
  value: "all" | AnnotationSeverity;
  label: string;
}> = [{ value: "all", label: "All severities" }, ...SEVERITY_OPTIONS];

export function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function authorInitials(author: AnnotationResponse["author"]): string {
  const source = author.name ?? author.email ?? "?";
  const parts = source.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts[1]?.[0] ?? "";
  if (first && second) return (first + second).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}
