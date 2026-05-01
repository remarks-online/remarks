import type { AnnotationIntent, AnnotationResponse, AnnotationSeverity } from "@remarks/shared";

export type AnnotationStatus = AnnotationResponse["status"];

export const STATUS_DOT_CLASS: Record<AnnotationStatus, string> = {
  to_do: "bg-amber-500",
  doing: "bg-blue-500",
  done: "bg-emerald-500",
  rejected: "bg-muted-foreground",
  acknowledged: "bg-cyan-500",
};

export const STATUS_LABEL: Record<AnnotationStatus, string> = {
  to_do: "To do",
  doing: "Doing",
  done: "Done",
  rejected: "Rejected",
  acknowledged: "Acknowledged",
};

// G1: action-shape classifier. Color hints picked to harmonize with status
// dots above without overlapping any of them — fix → rose (distinct from done
// emerald and rejected muted), change → violet (distinct from doing blue),
// question → sky (close to but separable from doing blue), approve → emerald
// (matches done since approve is a positive terminal signal).
export const INTENT_DOT_CLASS: Record<AnnotationIntent, string> = {
  fix: "bg-rose-500",
  change: "bg-violet-500",
  question: "bg-sky-500",
  approve: "bg-emerald-500",
};

export const INTENT_LABEL: Record<AnnotationIntent, string> = {
  fix: "Fix",
  change: "Change",
  question: "Question",
  approve: "Approve",
};

// G2: triage-by-priority. `blocking` is intentionally the same hue as
// `rejected` so the eye reads "stop" similarly; `important` matches `to_do`
// amber as "needs attention"; `suggestion` is neutral.
export const SEVERITY_DOT_CLASS: Record<AnnotationSeverity, string> = {
  blocking: "bg-rose-600",
  important: "bg-amber-500",
  suggestion: "bg-muted-foreground",
};

export const SEVERITY_LABEL: Record<AnnotationSeverity, string> = {
  blocking: "Blocking",
  important: "Important",
  suggestion: "Suggestion",
};

export function authorInitials(author: AnnotationResponse["author"]): string {
  const source = author.name?.trim() || author.email?.trim() || "";
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0]?.[0] ?? "";
    const last = parts[parts.length - 1]?.[0] ?? "";
    return (first + last).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
