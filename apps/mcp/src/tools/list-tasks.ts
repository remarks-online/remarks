import {
  type ListTasksOutput,
  listTasksInputSchema,
  listTasksOutputSchema,
} from "@remarks/mcp-schema";
import { McpToolError } from "../lib/mcp-error.js";
import { commentPreview, parseToolInput, projectAuthor, structuredToolResult } from "./shared.js";
import type { ToolHandler } from "./types.js";

// Phase 2 spec §3.2 list_tasks: "Default filter returns open (to_do) and
// in-progress (doing) tasks." Applied here (server-side) rather than the
// schema's default — the schema's `status` field stays optional so an empty
// array (`[]`) means "all statuses" and `undefined` falls back to the spec
// default. This matches how the spec describes the behavior in prose
// even though Zod's defaulting is value-on-omission.
const DEFAULT_STATUSES = ["to_do", "doing"] as const;

export const listTasksHandler: ToolHandler = async (args, ctx) => {
  const input = parseToolInput(listTasksInputSchema, args, "remarks_list_tasks");

  // Token is project-scoped (Phase 2 spec §5.1). Cross-project access surfaces
  // as NOT_FOUND so existence isn't leaked across projects, mirroring the
  // user-auth REST path's `requireProjectMember`.
  if (input.project_id !== ctx.auth.projectId) {
    throw new McpToolError("NOT_FOUND", "Project not found");
  }

  const statuses =
    input.status === undefined
      ? [...DEFAULT_STATUSES]
      : input.status.length > 0
        ? input.status
        : [];

  const params: Parameters<typeof ctx.api.fetchListAnnotations>[1] = {
    limit: input.limit,
  };
  if (statuses.length > 0) params.statuses = statuses;
  if (input.branch !== undefined) params.branch = input.branch;
  if (input.cursor !== undefined) params.cursor = input.cursor;

  const result = await ctx.api.fetchListAnnotations(input.project_id, params);
  if (!result) {
    throw new McpToolError("NOT_FOUND", "Project not found");
  }

  const tasks: ListTasksOutput["tasks"] = result.items.map((row) => ({
    id: row.id,
    status: row.status,
    branch: row.branchName,
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
