import {
  type ListTasksOutput,
  listTasksInputSchema,
  listTasksOutputSchema,
} from "@remarks/mcp-schema";
import type { AnnotationListResponse } from "@remarks/shared";
import { McpToolError } from "../lib/mcp-error.js";
import {
  commentPreview,
  parseToolInput,
  projectAuthor,
  requireOrgAccess,
  requireProjectAccess,
  requireScope,
  structuredToolResult,
} from "./shared.js";
import type { ToolHandler, ToolHandlerContext } from "./types.js";

// Phase 2 spec §3.2 list_tasks: "Default filter returns open (to_do) and
// in-progress (doing) tasks." Applied here (server-side) rather than the
// schema's default — the schema's `status` field stays optional so an empty
// array (`[]`) means "all statuses" and `undefined` falls back to the spec
// default. This matches how the spec describes the behavior in prose
// even though Zod's defaulting is value-on-omission.
const DEFAULT_STATUSES = ["to_do", "doing"] as const;

interface FetchParams {
  statuses?: string[];
  branch?: string;
  limit: number;
  cursor?: string;
}

async function fetchByMode(
  ctx: ToolHandlerContext,
  input: {
    project_id: string | undefined;
    org_id: string | undefined;
  },
  params: FetchParams
): Promise<{ result: AnnotationListResponse; mode: "project" | "org" | "personal" }> {
  if (input.project_id !== undefined) {
    await requireProjectAccess(ctx.auth, ctx.api, input.project_id);
    const fetched = await ctx.api.fetchListAnnotations(input.project_id, params);
    if (!fetched) throw new McpToolError("NOT_FOUND", "Project not found");
    return { result: fetched, mode: "project" };
  }
  // Personal/org list endpoints don't accept `branch` (the input schema
  // already rejects it), so strip it from params before calling them.
  const { branch: _branch, ...userParams } = params;
  void _branch;
  if (input.org_id !== undefined) {
    await requireOrgAccess(ctx.auth, ctx.api, input.org_id);
    const fetched = await ctx.api.fetchListOrgAnnotations(
      ctx.auth.clerkUserId,
      input.org_id,
      userParams
    );
    if (!fetched) throw new McpToolError("NOT_FOUND", "Organization not found");
    return { result: fetched, mode: "org" };
  }
  const fetched = await ctx.api.fetchListPersonalAnnotations(ctx.auth.clerkUserId, userParams);
  // Personal endpoint never returns 404 — the user is the caller. A null here
  // is an upstream bug and should bubble as INTERNAL.
  if (!fetched) throw new McpToolError("INTERNAL", "Personal annotation list unavailable");
  return { result: fetched, mode: "personal" };
}

export const listTasksHandler: ToolHandler = async (args, ctx) => {
  const input = parseToolInput(listTasksInputSchema, args, "remarks_list_tasks");
  requireScope(ctx.auth, "tasks:read", "remarks_list_tasks");

  const statuses =
    input.status === undefined
      ? [...DEFAULT_STATUSES]
      : input.status.length > 0
        ? input.status
        : [];

  const params: FetchParams = { limit: input.limit };
  if (statuses.length > 0) params.statuses = statuses;
  if (input.branch !== undefined) params.branch = input.branch;
  if (input.cursor !== undefined) params.cursor = input.cursor;

  const { result } = await fetchByMode(
    ctx,
    { project_id: input.project_id, org_id: input.org_id },
    params
  );

  // Map every row uniformly. Personal rows naturally have `branch: null` and
  // `project: null` because the underlying annotation has no projectId.
  const tasks: ListTasksOutput["tasks"] = result.items.map((row) => ({
    id: row.id,
    status: row.status,
    branch: row.branchName,
    project: row.projectId && row.projectSlug ? { id: row.projectId, slug: row.projectSlug } : null,
    url: row.url,
    target_type: row.targetType,
    comment_preview: commentPreview(row.commentText),
    author: projectAuthor(row.author),
    created_at: row.createdAt,
    has_screenshot: row.assets.some((a) => a.kind === "screenshot"),
  }));

  const output = listTasksOutputSchema.parse({
    tasks,
    next_cursor: result.nextCursor,
  });
  return structuredToolResult(output);
};
