import {
  type AcknowledgeOutput,
  acknowledgeInputSchema,
  acknowledgeOutputSchema,
} from "@remarks/mcp-schema";
import { McpToolError } from "../lib/mcp-error.js";
import { parseToolInput, requireScope, structuredToolResult } from "./shared.js";
import type { ToolHandler } from "./types.js";

const TOOL_NAME = "remarks_acknowledge" as const;

// G6 (gap-analysis): mark a task as acknowledged with an optional comment.
// Wraps two API calls — the status flip and the optional comment append —
// behind a single idempotent tool. When `comment` is set without `kind`, the
// comment is recorded as a `clarification_request` since the natural use of
// "acknowledge with a comment" is "I see this; here's a question before I
// start" (mirrors agentation's acknowledge-with-comment behavior).
export const acknowledgeHandler: ToolHandler = async (args, ctx) => {
  const input = parseToolInput(acknowledgeInputSchema, args, TOOL_NAME);
  requireScope(ctx.auth, "tasks:write", TOOL_NAME);

  // Idempotency hash captures both legs of the operation so two calls with the
  // same task_id but different comment text are treated as distinct ops.
  const idemPayload = {
    task_id: input.task_id,
    ...(input.comment !== undefined ? { comment: input.comment } : {}),
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
  };

  if (input.idempotency_key) {
    const cached = await ctx.idempotency.check<AcknowledgeOutput>({
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

  const statusResult = await ctx.api.updateAnnotationStatus(
    input.task_id,
    ctx.auth.clerkUserId,
    ctx.auth.oauthClientName,
    "acknowledged",
    undefined,
    undefined
  );
  if (!statusResult) {
    throw new McpToolError("NOT_FOUND", "Task not found");
  }
  if (statusResult.status !== "acknowledged") {
    // Defensive: API returned a status the tool didn't request. Surface as
    // INTERNAL so the agent doesn't loop on a malformed response.
    throw new McpToolError("INTERNAL", `Unexpected status from API: ${statusResult.status}`);
  }

  let commentEventId: string | null = null;
  if (input.comment !== undefined) {
    const kind = input.kind ?? "clarification_request";
    const commentResult = await ctx.api.addAnnotationComment(
      input.task_id,
      ctx.auth.clerkUserId,
      ctx.auth.oauthClientName,
      input.comment,
      kind
    );
    if (!commentResult) {
      // The status flip succeeded but the comment leg's task lookup 404'd —
      // that's a race (task got deleted between calls) or an upstream bug.
      // Surface as INTERNAL since the partial success isn't recoverable from
      // the agent's side; the human will see the acknowledged status without
      // the comment.
      throw new McpToolError(
        "INTERNAL",
        "Status updated but comment append failed — task may have been deleted concurrently"
      );
    }
    commentEventId = commentResult.eventId;
  }

  const output = acknowledgeOutputSchema.parse({
    id: statusResult.id,
    status: "acknowledged",
    updated_at: statusResult.updatedAt,
    comment_event_id: commentEventId,
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
