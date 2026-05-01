import {
  ANNOTATION_STATUSES,
  ANNOTATION_TARGET_TYPES,
  annotationStatusSchema,
  annotationTargetTypeSchema,
  rectSchema,
  viewportSchema,
} from "@remarks/shared";
import { z } from "zod";

// --- Error model (Phase 2 spec §3.3) ---

export const MCP_ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "CONFLICT",
  "RATE_LIMIT",
  "INTERNAL",
] as const;

export type McpErrorCode = (typeof MCP_ERROR_CODES)[number];

export const mcpErrorCodeSchema = z.enum(MCP_ERROR_CODES);

export const mcpErrorPayloadSchema = z.object({
  code: mcpErrorCodeSchema,
  message: z.string(),
  // VALIDATION_ERROR carries Zod issues here.
  details: z.unknown().optional(),
  // RATE_LIMIT advises clients when to retry.
  retry_after_seconds: z.number().int().nonnegative().optional(),
  // INTERNAL surfaces a request id so support can correlate.
  request_id: z.string().optional(),
});

export type McpErrorPayload = z.infer<typeof mcpErrorPayloadSchema>;

// --- Mutator primitives ---

// Mutators accept an optional idempotency_key per §3.1; the server caches
// (key → response) for 24h.
export const idempotencyKeySchema = z.string().uuid();

// Subset of statuses agents may set; agents cannot reset to to_do (§3.2).
// `acknowledged` (G3) lets the agent signal "I've read this task" without
// committing to do the work yet — useful for triage and hands-free loops.
export const AGENT_UPDATE_STATUSES = ["doing", "done", "rejected", "acknowledged"] as const;
export type AgentUpdateStatus = (typeof AGENT_UPDATE_STATUSES)[number];
export const agentUpdateStatusSchema = z.enum(AGENT_UPDATE_STATUSES);

// Optional metadata on agent-authored comments (§3.2 add_task_comment).
export const MCP_COMMENT_KINDS = [
  "clarification_request",
  "progress_update",
  "completion_note",
] as const;
export type McpCommentKind = (typeof MCP_COMMENT_KINDS)[number];
export const mcpCommentKindSchema = z.enum(MCP_COMMENT_KINDS);

// open_pr response status. Only pending_github_integration is reachable until
// the GitHub App ships in Phase 3.
export const OPEN_PR_STATUSES = ["pending_github_integration", "opened"] as const;
export type OpenPrStatus = (typeof OPEN_PR_STATUSES)[number];
export const openPrStatusSchema = z.enum(OPEN_PR_STATUSES);

// --- Task-shaped sub-schemas (wire format = snake_case) ---

// Snake_case dom_context used in get_task. The internal @remarks/shared
// domContextSchema is camelCase; the MCP server translates at the boundary.
export const mcpDomContextSchema = z.object({
  tag_name: z.string().optional(),
  classes: z.array(z.string()).optional(),
  text_content: z.string().optional(),
  computed_styles: z.record(z.string(), z.string()).optional(),
  ancestors: z
    .array(
      z.object({
        tag_name: z.string(),
        classes: z.array(z.string()).optional(),
      })
    )
    .optional(),
});

export type McpDomContext = z.infer<typeof mcpDomContextSchema>;

// Author info exposed to agents (§3.2): name + email only. The internal
// author shape includes id/avatarUrl; the MCP server projects to this subset.
export const mcpTaskAuthorSchema = z.object({
  name: z.string(),
  email: z.string(),
});

export type McpTaskAuthor = z.infer<typeof mcpTaskAuthorSchema>;

// Project pointer surfaced on list_tasks rows so org-mode results can identify
// which project a row belongs to without a follow-up call.
export const mcpTaskProjectSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
});

export type McpTaskProject = z.infer<typeof mcpTaskProjectSchema>;

// Compact task shape returned by list_tasks (§3.2).
// `branch` and `project` are nullable because personal tasks have no project
// (and therefore no branch). Project-scoped and org-scoped rows always carry
// both.
export const mcpTaskSummarySchema = z.object({
  id: z.string().uuid(),
  status: annotationStatusSchema,
  branch: z.string().nullable(),
  project: mcpTaskProjectSchema.nullable(),
  url: z.string().url(),
  target_type: annotationTargetTypeSchema,
  comment_preview: z.string(),
  author: mcpTaskAuthorSchema,
  created_at: z.string().datetime(),
  has_screenshot: z.boolean(),
});

export type McpTaskSummary = z.infer<typeof mcpTaskSummarySchema>;

// Pointer surfaced in get_task.related_tasks (§3.2).
export const mcpRelatedTaskSchema = z.object({
  id: z.string().uuid(),
  comment_preview: z.string(),
  status: annotationStatusSchema,
});

export type McpRelatedTask = z.infer<typeof mcpRelatedTaskSchema>;

// --- Re-exports of wire-compatible primitives from @remarks/shared ---
// Status/target enum values and rect/viewport field names are wire-compatible,
// so we surface them under task-flavored names rather than duplicating.

export const TASK_STATUSES = ANNOTATION_STATUSES;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const taskStatusSchema = annotationStatusSchema;

export const TASK_TARGET_TYPES = ANNOTATION_TARGET_TYPES;
export type TaskTargetType = (typeof TASK_TARGET_TYPES)[number];
export const taskTargetTypeSchema = annotationTargetTypeSchema;

export { rectSchema, viewportSchema };
export type Rect = z.infer<typeof rectSchema>;
export type Viewport = z.infer<typeof viewportSchema>;
