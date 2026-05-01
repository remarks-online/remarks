import type { AnnotationResponse } from "@remarks/shared";

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
