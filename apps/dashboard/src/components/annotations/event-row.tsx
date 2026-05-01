"use client";

import type { AnnotationEventResponse, AnnotationStatus } from "@remarks/shared";
import { CheckCircle2, Edit3, MessageSquarePlus, Plus, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import { STATUS_LABEL } from "./status-ui";

interface EventRowProps {
  event: AnnotationEventResponse;
}

interface FormattedEvent {
  icon: ReactNode;
  headline: string;
  // G4: optional second line under the headline. Used today to surface the
  // dismissal `reason` on rejected status_changed / agent_updated_status
  // events; left as a generic slot so future event types can hook in.
  detail?: ReactNode;
}

function rejectionReason(event: AnnotationEventResponse): string | null {
  const to = event.payload.to as AnnotationStatus | undefined;
  if (to !== "rejected") return null;
  const reason = event.payload.reason;
  return typeof reason === "string" && reason.length > 0 ? reason : null;
}

function formatStatusChange(
  event: AnnotationEventResponse,
  actor: string,
  verb: string
): FormattedEvent {
  const from = (event.payload.from as AnnotationStatus | undefined) ?? null;
  const to = (event.payload.to as AnnotationStatus | undefined) ?? null;
  const fromLabel = from ? STATUS_LABEL[from] : "?";
  const toLabel = to ? STATUS_LABEL[to] : "?";
  const reason = rejectionReason(event);
  return {
    icon: <Workflow className="h-4 w-4" />,
    headline: `${actor} ${verb}: ${fromLabel} → ${toLabel}`,
    ...(reason !== null
      ? {
          detail: (
            <span className="text-xs text-muted-foreground">
              <span className="font-medium">Reason:</span> {reason}
            </span>
          ),
        }
      : {}),
  };
}

function formatEvent(event: AnnotationEventResponse): FormattedEvent {
  const actor = event.actor?.name ?? event.actor?.email ?? "Someone";
  switch (event.type) {
    case "created":
      return { icon: <Plus className="h-4 w-4" />, headline: `${actor} created this` };
    case "status_changed":
      return formatStatusChange(event, actor, "changed status");
    case "agent_updated_status":
      return formatStatusChange(event, actor, "updated status");
    case "comment_edited":
      return { icon: <Edit3 className="h-4 w-4" />, headline: `${actor} edited the comment` };
    case "comment_added":
      return {
        icon: <MessageSquarePlus className="h-4 w-4" />,
        headline: `${actor} added a comment`,
      };
    case "resolved":
      return { icon: <CheckCircle2 className="h-4 w-4" />, headline: `${actor} resolved this` };
    case "agent_acknowledged":
      return {
        icon: <Workflow className="h-4 w-4" />,
        headline: `${actor} acknowledged this`,
      };
    case "agent_commented": {
      const comment = typeof event.payload.comment === "string" ? event.payload.comment : "";
      const kind = typeof event.payload.kind === "string" ? event.payload.kind : null;
      const detail =
        comment || kind ? (
          <span className="text-xs text-muted-foreground">
            {kind ? <span className="font-medium">{kind.replace(/_/g, " ")}: </span> : null}
            {comment}
          </span>
        ) : undefined;
      return {
        icon: <MessageSquarePlus className="h-4 w-4" />,
        headline: `${actor} commented`,
        ...(detail !== undefined ? { detail } : {}),
      };
    }
    default:
      // Forward-compat: future event types surface as raw event type until we
      // write a renderer for them.
      return { icon: <Workflow className="h-4 w-4" />, headline: `${actor} · ${event.type}` };
  }
}

export function EventRow({ event }: EventRowProps) {
  const { icon, headline, detail } = formatEvent(event);
  return (
    <li className="flex items-start gap-3 py-2">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="flex-1 text-sm">
        <p>{headline}</p>
        {detail ? <p className="mt-0.5">{detail}</p> : null}
        <time className="text-xs text-muted-foreground">
          {new Date(event.createdAt).toLocaleString()}
        </time>
      </div>
    </li>
  );
}
