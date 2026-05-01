import { type DismissOutput, dismissInputSchema, dismissOutputSchema } from "@remarks/mcp-schema";
import { McpToolError } from "../lib/mcp-error.js";
import { parseToolInput, requireScope, structuredToolResult } from "./shared.js";
import type { ToolHandler } from "./types.js";

const TOOL_NAME = "remarks_dismiss" as const;

// G7 (gap-analysis): reject a task with a required reason. The schema
// enforces ≥10 chars; the API route applies the same floor (G4) on the
// dedicated `reason` field so direct `update_task_status` calls can't
// bypass. The reason lands on the resulting agent_updated_status event
// payload as `payload.reason` and is surfaced inline by the dashboard.
export const dismissHandler: ToolHandler = async (args, ctx) => {
  const input = parseToolInput(dismissInputSchema, args, TOOL_NAME);
  requireScope(ctx.auth, "tasks:write", TOOL_NAME);

  const idemPayload = {
    task_id: input.task_id,
    reason: input.reason,
  };

  if (input.idempotency_key) {
    const cached = await ctx.idempotency.check<DismissOutput>({
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
    "rejected",
    undefined,
    input.reason
  );
  if (!result) {
    throw new McpToolError("NOT_FOUND", "Task not found");
  }
  if (result.status !== "rejected") {
    throw new McpToolError("INTERNAL", `Unexpected status from API: ${result.status}`);
  }

  const output = dismissOutputSchema.parse({
    id: result.id,
    status: "rejected",
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
