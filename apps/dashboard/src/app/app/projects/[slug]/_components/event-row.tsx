"use client";

import type { AnnotationEventResponse, AnnotationStatus } from "@remarks/shared";
import { CheckCircle2, Edit3, MessageSquarePlus, Plus, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import { STATUS_LABEL } from "./status-ui";

interface EventRowProps {
  event: AnnotationEventResponse;
}

function formatEvent(event: AnnotationEventResponse): {
  icon: ReactNode;
  headline: string;
} {
  const actor = event.actor?.name ?? event.actor?.email ?? "Someone";
  switch (event.type) {
    case "created":
      return { icon: <Plus className="h-4 w-4" />, headline: `${actor} created this` };
    case "status_changed": {
      const from = (event.payload.from as AnnotationStatus | undefined) ?? null;
      const to = (event.payload.to as AnnotationStatus | undefined) ?? null;
      const fromLabel = from ? STATUS_LABEL[from] : "?";
      const toLabel = to ? STATUS_LABEL[to] : "?";
      return {
        icon: <Workflow className="h-4 w-4" />,
        headline: `${actor} changed status: ${fromLabel} → ${toLabel}`,
      };
    }
    case "comment_edited":
      return { icon: <Edit3 className="h-4 w-4" />, headline: `${actor} edited the comment` };
    case "comment_added":
      return {
        icon: <MessageSquarePlus className="h-4 w-4" />,
        headline: `${actor} added a comment`,
      };
    case "resolved":
      return { icon: <CheckCircle2 className="h-4 w-4" />, headline: `${actor} resolved this` };
    default:
      // Forward-compat: Phase 2 agent events surface as raw event type until we
      // write a renderer for them.
      return { icon: <Workflow className="h-4 w-4" />, headline: `${actor} · ${event.type}` };
  }
}

export function EventRow({ event }: EventRowProps) {
  const { icon, headline } = formatEvent(event);
  return (
    <li className="flex items-start gap-3 py-2">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="flex-1 text-sm">
        <p>{headline}</p>
        <time className="text-xs text-muted-foreground">
          {new Date(event.createdAt).toLocaleString()}
        </time>
      </div>
    </li>
  );
}
