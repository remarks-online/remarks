import {
  type McpAnnotationSnapshot,
  type WatchAnnotationsOutput,
  watchAnnotationsInputSchema,
  watchAnnotationsOutputSchema,
} from "@remarks/mcp-schema";
import type { DomContextResponse } from "@remarks/shared";
import type { WatchEventPayload } from "../lib/api-client.js";
import { McpToolError } from "../lib/mcp-error.js";
import {
  parseToolInput,
  projectAuthor,
  requireOrgAccess,
  requireProjectAccess,
  requireScope,
  structuredToolResult,
} from "./shared.js";
import type { ToolHandler } from "./types.js";

const TOOL_NAME = "remarks_watch_annotations" as const;

// Phase 2 spec §3.2 dom_context wire shape is snake_case. Same projection as
// `apps/mcp/src/tools/get-task.ts`; duplicated here rather than shared
// because the two tools project to slightly different snapshot shapes and
// a shared helper would obscure where each field lands.
function projectDomContext(value: DomContextResponse | null): McpAnnotationSnapshot["dom_context"] {
  if (value === null) return null;
  const out: Record<string, unknown> = {};
  if (value.tagName !== null) out.tag_name = value.tagName;
  if (value.classes !== null) out.classes = value.classes;
  if (value.textContent !== null) out.text_content = value.textContent;
  if (value.computedStyles !== null) out.computed_styles = value.computedStyles;
  if (value.ancestors !== null) {
    out.ancestors = value.ancestors.map((a) => {
      const projected: Record<string, unknown> = { tag_name: a.tagName };
      if (a.classes !== null) projected.classes = a.classes;
      return projected;
    });
  }
  return out as McpAnnotationSnapshot["dom_context"];
}

function projectAnnotation(
  annotation: WatchEventPayload["annotation"]
): McpAnnotationSnapshot | null {
  if (annotation === null) return null;
  const screenshot = annotation.assets.find((a) => a.kind === "screenshot");
  const target: McpAnnotationSnapshot["target"] = {
    type: annotation.targetType,
    ...(annotation.targetSelector !== null ? { selector: annotation.targetSelector } : {}),
    ...(annotation.targetCoords !== null ? { coords: annotation.targetCoords } : {}),
  };
  return {
    id: annotation.id,
    status: annotation.status,
    branch: annotation.branchName,
    project:
      annotation.projectId && annotation.projectSlug
        ? { id: annotation.projectId, slug: annotation.projectSlug }
        : null,
    url: annotation.url,
    comment: annotation.commentText,
    target,
    viewport: annotation.viewport,
    dom_context: projectDomContext(annotation.domContext),
    framework_hint: annotation.frameworkHint,
    screenshot_url: screenshot?.url ?? null,
    author: projectAuthor(annotation.author),
    group_id: annotation.groupId,
    group_size: annotation.groupSize,
    created_at: annotation.createdAt,
    updated_at: annotation.updatedAt,
  };
}

// G10 (gap-analysis): hands-free agent loop. Long-polls the annotation event
// stream via the API's watch endpoint, projects camelCase API payloads into
// the snake_case wire shape, and surfaces inline annotation snapshots so the
// agent can act without a follow-up `remarks_get_task` call.
//
// Scope resolution mirrors `remarks_list_tasks` / `remarks_get_pending`:
//   project_id → project mode; org_id → org mode; scope=personal → personal
//   mode; scope=all (or no scope marker) → cross-scope ("all") mode.
//
// `auto_acknowledge: true` requires `tasks:write` since the API will emit
// real `agent_acknowledged` events as a side effect; agents using read-only
// tokens should leave it false.
export const watchAnnotationsHandler: ToolHandler = async (args, ctx) => {
  const input = parseToolInput(watchAnnotationsInputSchema, args, TOOL_NAME);
  requireScope(ctx.auth, "tasks:read", TOOL_NAME);
  if (input.auto_acknowledge) {
    requireScope(ctx.auth, "tasks:write", TOOL_NAME);
  }

  // Authorize the requested scope before opening the long-poll. Membership
  // changes mid-call aren't reflected — same trade-off as the SSE path.
  if (input.project_id !== undefined) {
    await requireProjectAccess(ctx.auth, ctx.api, input.project_id);
  } else if (input.org_id !== undefined) {
    await requireOrgAccess(ctx.auth, ctx.api, input.org_id);
  }
  // `scope === "personal"` and `scope === "all"` need no extra check —
  // the API endpoint authorizes via clerkUserId itself.

  const params: Parameters<typeof ctx.api.fetchWatchAnnotations>[0] = {
    clerkUserId: ctx.auth.clerkUserId,
    oauthClientName: ctx.auth.oauthClientName,
    waitSeconds: input.wait_seconds,
    batchWindowMs: input.batch_window_ms,
    limit: input.limit,
    autoAcknowledge: input.auto_acknowledge,
  };
  if (input.since !== undefined) params.since = input.since;
  if (input.intent !== undefined && input.intent.length > 0) params.intents = input.intent;
  if (input.severity !== undefined && input.severity.length > 0) {
    params.severities = input.severity;
  }
  if (input.status !== undefined && input.status.length > 0) params.statuses = input.status;
  if (input.event_types !== undefined && input.event_types.length > 0) {
    params.eventTypes = input.event_types;
  }
  if (input.branch !== undefined) params.branch = input.branch;

  if (input.project_id !== undefined) {
    params.projectId = input.project_id;
  } else if (input.org_id !== undefined) {
    params.userMode = { mode: "org", orgId: input.org_id };
  } else if (input.scope === "personal") {
    params.userMode = { mode: "personal" };
  } else {
    // `scope: "all"` or omitted — the spec default is "all".
    params.userMode = { mode: "all" };
  }

  const result = await ctx.api.fetchWatchAnnotations(params);
  if (!result) {
    // 404 from the API means the resolved scope rejected the caller — most
    // commonly a project_id the user can't see. requireProjectAccess above
    // should have caught this, but keep the surface tagged.
    throw new McpToolError("NOT_FOUND", "Watch scope not found");
  }

  const events: WatchAnnotationsOutput["events"] = result.events.map((event) => ({
    id: event.streamEvent.id,
    type: event.streamEvent.type,
    annotation_id: event.streamEvent.annotationId,
    project_id: event.streamEvent.projectId,
    actor_type: event.streamEvent.actorType,
    actor_oauth_client_id: event.streamEvent.actorOauthClientId,
    payload: event.streamEvent.payload,
    created_at: event.streamEvent.createdAt,
    annotation: projectAnnotation(event.annotation),
    auto_acknowledged: event.autoAcknowledged,
  }));

  const output = watchAnnotationsOutputSchema.parse({
    events,
    next_cursor: result.nextCursor,
    idle: result.idle,
    replay_truncated: result.replayTruncated,
    more_available: result.moreAvailable,
  });
  return structuredToolResult(output);
};
