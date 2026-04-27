import { type GetTaskOutput, getTaskInputSchema, getTaskOutputSchema } from "@remarks/mcp-schema";
import type { McpDomContextRow } from "../lib/api-client.js";
import { McpToolError } from "../lib/mcp-error.js";
import {
  commentPreview,
  parseToolInput,
  projectAuthor,
  requireScope,
  structuredToolResult,
} from "./shared.js";
import type { ToolHandler } from "./types.js";

// Spec §3.2 get_task `dom_context` is snake_case; the API returns the
// internal camelCase shape (matching annotations.dom_context jsonb). Project
// here, not in a generic mapper — the four tool shapes diverge enough that a
// generic deep-snake transform would silently translate fields that are
// specced as camelCase (like `viewport.dpr`).
function projectDomContext(value: McpDomContextRow | null): GetTaskOutput["dom_context"] {
  if (value === null) return null;
  const out: Record<string, unknown> = {};
  if (value.tagName !== undefined) out.tag_name = value.tagName;
  if (value.classes !== undefined) out.classes = value.classes;
  if (value.textContent !== undefined) out.text_content = value.textContent;
  if (value.computedStyles !== undefined) out.computed_styles = value.computedStyles;
  if (value.ancestors !== undefined) {
    out.ancestors = value.ancestors.map((a) => {
      const projected: Record<string, unknown> = { tag_name: a.tagName };
      if (a.classes !== undefined) projected.classes = a.classes;
      return projected;
    });
  }
  return out as GetTaskOutput["dom_context"];
}

export const getTaskHandler: ToolHandler = async (args, ctx) => {
  const input = parseToolInput(getTaskInputSchema, args, "remarks_get_task");
  requireScope(ctx.auth, "tasks:read", "remarks_get_task");

  // ADR-0015: the API resolves the annotation's project and checks
  // membership for the Clerk user. Cross-project access surfaces as
  // NOT_FOUND so existence isn't leaked.
  const result = await ctx.api.fetchAnnotation(input.task_id, ctx.auth.clerkUserId);
  if (!result) {
    throw new McpToolError("NOT_FOUND", "Task not found");
  }
  const { annotation, relatedTasks } = result;

  // The list endpoint returns assets with presigned URLs already; the first
  // screenshot wins (an annotation has at most one in Phase 1; future kinds
  // stay null). Spec §3.2: "fetch it only if your model is multimodal" — so
  // surfacing a single string is enough.
  const screenshot = annotation.assets.find((a) => a.kind === "screenshot");

  const target: GetTaskOutput["target"] = {
    type: annotation.targetType,
    ...(annotation.targetSelector !== null ? { selector: annotation.targetSelector } : {}),
    ...(annotation.targetCoords !== null ? { coords: annotation.targetCoords } : {}),
  };

  const output = getTaskOutputSchema.parse({
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
    related_tasks: relatedTasks.map((r) => ({
      id: r.id,
      status: r.status,
      comment_preview: commentPreview(r.commentText),
    })),
    created_at: annotation.createdAt,
    updated_at: annotation.updatedAt,
  });
  return structuredToolResult(output);
};
