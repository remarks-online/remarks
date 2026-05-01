import {
  type GetAllPendingOutput,
  getAllPendingInputSchema,
  getAllPendingOutputSchema,
} from "@remarks/mcp-schema";
import { McpToolError } from "../lib/mcp-error.js";
import {
  commentPreview,
  parseToolInput,
  projectAuthor,
  requireScope,
  structuredToolResult,
} from "./shared.js";
import type { ToolHandler } from "./types.js";

const TOOL_NAME = "remarks_get_all_pending" as const;

const PENDING_STATUSES = ["to_do", "acknowledged"] as const;

// G8b (gap-analysis): cross-scope triage. Wraps the new
// `/internal/mcp/users/:clerkUserId/all-annotations` route, which itself
// reuses listAnnotationsForUser's existing "all" scope (personal +
// every member project regardless of org). No project-access gate here —
// the API endpoint scopes by membership, returning only rows the caller
// can already see.
export const getAllPendingHandler: ToolHandler = async (args, ctx) => {
  const input = parseToolInput(getAllPendingInputSchema, args, TOOL_NAME);
  requireScope(ctx.auth, "tasks:read", TOOL_NAME);

  const params: Parameters<typeof ctx.api.fetchListAllAnnotations>[1] = {
    statuses: [...PENDING_STATUSES],
    limit: input.limit,
  };
  if (input.cursor !== undefined) params.cursor = input.cursor;

  const result = await ctx.api.fetchListAllAnnotations(ctx.auth.clerkUserId, params);
  // The all-annotations endpoint never 404s for a known user (the user is
  // the caller). A null here is an upstream bug.
  if (!result) {
    throw new McpToolError("INTERNAL", "All-annotations list unavailable");
  }

  const tasks: GetAllPendingOutput["tasks"] = result.items.map((row) => ({
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

  const output = getAllPendingOutputSchema.parse({
    tasks,
    next_cursor: result.nextCursor,
  });
  return structuredToolResult(output);
};
