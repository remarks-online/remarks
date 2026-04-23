import type { AnnotationResponse } from "@remarks/shared";
import type { BadgeProps } from "@remarks/ui";

export const STATUS_VARIANT: Record<
  AnnotationResponse["status"],
  NonNullable<BadgeProps["variant"]>
> = {
  to_do: "outline",
  doing: "default",
  done: "secondary",
  rejected: "destructive",
};

export const STATUS_LABEL: Record<AnnotationResponse["status"], string> = {
  to_do: "To do",
  doing: "In progress",
  done: "Done",
  rejected: "Rejected",
};

export const STATUS_OPTIONS: ReadonlyArray<{
  value: AnnotationResponse["status"];
  label: string;
}> = [
  { value: "to_do", label: STATUS_LABEL.to_do },
  { value: "doing", label: STATUS_LABEL.doing },
  { value: "done", label: STATUS_LABEL.done },
  { value: "rejected", label: STATUS_LABEL.rejected },
];

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
