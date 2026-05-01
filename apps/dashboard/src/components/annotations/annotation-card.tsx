"use client";

import {
  INTENT_LABEL,
  INTENT_VARIANT,
  SEVERITY_LABEL,
  SEVERITY_VARIANT,
  STATUS_LABEL,
  STATUS_VARIANT,
  authorInitials,
  safeHostname,
} from "@/components/annotations/status-ui";
import type { AnnotationResponse } from "@remarks/shared";
import { Badge, Card, CardContent } from "@remarks/ui";

interface AnnotationCardProps {
  annotation: AnnotationResponse;
  isSelected: boolean;
  onSelect: () => void;
}

export function AnnotationCard({ annotation, isSelected, onSelect }: AnnotationCardProps) {
  const screenshot = annotation.assets.find((a) => a.kind === "screenshot");
  const hostname = safeHostname(annotation.url);
  const initials = authorInitials(annotation.author);
  const authorLabel = annotation.author.name ?? annotation.author.email ?? "Unknown";

  return (
    <Card
      className={`overflow-hidden transition-colors ${
        isSelected ? "ring-2 ring-ring" : "hover:bg-muted/40"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-label={`Open annotation: ${annotation.commentText.slice(0, 80)}`}
        className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CardContent className="flex gap-4 p-4">
          <div className="relative h-28 w-44 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
            {screenshot ? (
              <img src={screenshot.url} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                no preview
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Badge variant={STATUS_VARIANT[annotation.status]}>
                {STATUS_LABEL[annotation.status]}
              </Badge>
              {annotation.severity ? (
                <Badge variant={SEVERITY_VARIANT[annotation.severity]}>
                  {SEVERITY_LABEL[annotation.severity]}
                </Badge>
              ) : null}
              {annotation.intent ? (
                <Badge variant={INTENT_VARIANT[annotation.intent]}>
                  {INTENT_LABEL[annotation.intent]}
                </Badge>
              ) : null}
              <span className="text-xs text-muted-foreground">{annotation.targetType}</span>
              <span className="text-xs text-muted-foreground">·</span>
              <time className="text-xs text-muted-foreground">
                {new Date(annotation.createdAt).toLocaleDateString()}
              </time>
            </div>
            <p className="mt-2 line-clamp-3 text-sm">{annotation.commentText}</p>
            <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-foreground">
                  {initials}
                </span>
                <span className="truncate">{authorLabel}</span>
              </span>
              {hostname ? <span className="truncate">· {hostname}</span> : null}
            </div>
          </div>
        </CardContent>
      </button>
    </Card>
  );
}
