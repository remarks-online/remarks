"use client";

import type { AnnotationStreamStatus } from "@/hooks/use-annotation-stream";
import { Badge } from "@remarks/ui";

interface LiveIndicatorProps {
  status: AnnotationStreamStatus;
}

export function LiveIndicator({ status }: LiveIndicatorProps) {
  if (status === "open") {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
        aria-live="polite"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        Live
      </Badge>
    );
  }

  if (status === "connecting" || status === "reconnecting") {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 border-amber-500/40 text-amber-700 dark:text-amber-400"
        aria-live="polite"
      >
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        {status === "connecting" ? "Connecting…" : "Reconnecting…"}
      </Badge>
    );
  }

  return null;
}
