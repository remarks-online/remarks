import {
  type AddTaskCommentOutput,
  addTaskCommentInputSchema,
  addTaskCommentOutputSchema,
} from "@remarks/mcp-schema";
import { McpToolError } from "../lib/mcp-error.js";
import { parseToolInput, requireScope, structuredToolResult } from "./shared.js";
import type { ToolHandler } from "./types.js";

const TOOL_NAME = "remarks_add_task_comment" as const;

// Spec §3.2: agent posts a comment-style event on a task. Idempotent via the
// shared cache. The `kind` field is part of the idempotency payload — two
// calls with the same comment but different kinds are distinct operations.
export const addTaskCommentHandler: ToolHandler = async (args, ctx) => {
  const input = parseToolInput(addTaskCommentInputSchema, args, TOOL_NAME);
  requireScope(ctx.auth, "tasks:write", TOOL_NAME);

  const idemPayload = {
    task_id: input.task_id,
    comment: input.comment,
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
  };

  if (input.idempotency_key) {
    const cached = await ctx.idempotency.check<AddTaskCommentOutput>({
      tool: TOOL_NAME,
      tokenId: ctx.auth.clerkUserId,
      key: input.idempotency_key,
      payload: idemPayload,
    });
    if (cached.kind === "hit") return structuredToolResult(cached.response);
    if (cached.kind === "conflict") {
      throw new McpToolError("CONFLICT", "Idempotency key reused with a different payload");
    }
  }

  const result = await ctx.api.addAnnotationComment(
    input.task_id,
    ctx.auth.clerkUserId,
    ctx.auth.oauthClientName,
    input.comment,
    input.kind
  );
  if (!result) {
    throw new McpToolError("NOT_FOUND", "Task not found");
  }

  const output = addTaskCommentOutputSchema.parse({
    event_id: result.eventId,
    created_at: result.createdAt,
  });

  if (input.idempotency_key) {
    await ctx.idempotency.store({
      tool: TOOL_NAME,
      tokenId: ctx.auth.clerkUserId,
      key: input.idempotency_key,
      payload: idemPayload,
      response: output,
    });
  }

  return structuredToolResult(output);
};
