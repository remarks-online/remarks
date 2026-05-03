import {
  type GetPendingOutput,
  getPendingInputSchema,
  getPendingOutputSchema,
} from "@remarks/mcp-schema";
import { McpToolError } from "../lib/mcp-error.js";
import {
  commentPreview,
  parseToolInput,
  projectAuthor,
  requireProjectAccess,
  requireScope,
  structuredToolResult,
} from "./shared.js";
import type { ToolHandler } from "./types.js";

const TOOL_NAME = "remarks_get_pending" as const;

// "Pending" = not actively being worked on. `to_do` (no agent has picked it
// up) and `acknowledged` (an agent has read it but isn't yet doing) both
// qualify. `doing` is excluded — that's actively in flight. Terminal states
// (`done`, `rejected`) are obviously excluded.
const PENDING_STATUSES = ["to_do", "acknowledged"] as const;

// G8a (gap-analysis): project-scoped triage view. Thin wrapper over the
// existing project-list endpoint with the pending status filter baked in,
// so agents don't have to re-derive it client-side.
export const getPendingHandler: ToolHandler = async (args, ctx) => {
  const input = parseToolInput(getPendingInputSchema, args, TOOL_NAME);
  requireScope(ctx.auth, "tasks:read", TOOL_NAME);
  await requireProjectAccess(ctx.auth, ctx.api, input.project_id);

  const params: Parameters<typeof ctx.api.fetchListAnnotations>[1] = {
    statuses: [...PENDING_STATUSES],
    limit: input.limit,
  };
  if (input.branch !== undefined) params.branch = input.branch;
  if (input.cursor !== undefined) params.cursor = input.cursor;

  const result = await ctx.api.fetchListAnnotations(input.project_id, params);
  if (!result) throw new McpToolError("NOT_FOUND", "Project not found");

  const tasks: GetPendingOutput["tasks"] = result.items.map((row) => ({
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
    // G17: surface group membership so agents can spot batched feedback.
    group_id: row.groupId,
    group_size: row.groupSize,
  }));

  const output = getPendingOutputSchema.parse({
    tasks,
    next_cursor: result.nextCursor,
  });
  return structuredToolResult(output);
};
