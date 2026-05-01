import {
  type UpdateTaskStatusOutput,
  updateTaskStatusInputSchema,
  updateTaskStatusOutputSchema,
} from "@remarks/mcp-schema";
import { McpToolError } from "../lib/mcp-error.js";
import { parseToolInput, requireScope, structuredToolResult } from "./shared.js";
import type { ToolHandler } from "./types.js";

const TOOL_NAME = "remarks_update_task_status" as const;

// Spec §3.2: agent flips a task to doing/done/rejected. Idempotent via 24h
// Redis cache when `idempotency_key` is supplied — duplicate calls return the
// cached response without re-executing; replays with a different payload
// surface as CONFLICT (§3.3).
export const updateTaskStatusHandler: ToolHandler = async (args, ctx) => {
  const input = parseToolInput(updateTaskStatusInputSchema, args, TOOL_NAME);
  requireScope(ctx.auth, "tasks:write", TOOL_NAME);

  // Hash the request-shape fields the API actually consumes — the
  // idempotency_key itself isn't part of the payload (it's the cache key).
  // G4: `reason` participates in the hash so a replay with a different
  // dismissal reason surfaces as CONFLICT instead of silently returning the
  // cached result.
  const idemPayload = {
    task_id: input.task_id,
    status: input.status,
    ...(input.note !== undefined ? { note: input.note } : {}),
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
  };

  if (input.idempotency_key) {
    const cached = await ctx.idempotency.check<UpdateTaskStatusOutput>({
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

  const result = await ctx.api.updateAnnotationStatus(
    input.task_id,
    ctx.auth.clerkUserId,
    ctx.auth.oauthClientName,
    input.status,
    input.note,
    input.reason
  );
  if (!result) {
    throw new McpToolError("NOT_FOUND", "Task not found");
  }
  // The API returns a broader status enum (includes "to_do") because the
  // table column is the full annotation status; agents only ever reach this
  // path with one of the agent-settable values, but Zod re-narrows on parse.
  if (
    result.status !== "doing" &&
    result.status !== "done" &&
    result.status !== "rejected" &&
    result.status !== "acknowledged"
  ) {
    // Defensive: would mean the API returned a status the agent didn't
    // request, which shouldn't happen. Surface as INTERNAL so the agent
    // doesn't loop on a malformed response.
    throw new McpToolError("INTERNAL", `Unexpected status from API: ${result.status}`);
  }

  const output = updateTaskStatusOutputSchema.parse({
    id: result.id,
    status: result.status,
    updated_at: result.updatedAt,
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
