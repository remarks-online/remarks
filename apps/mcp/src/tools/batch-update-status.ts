import {
  type BatchUpdateStatusOutput,
  batchUpdateStatusInputSchema,
  batchUpdateStatusOutputSchema,
} from "@remarks/mcp-schema";
import { McpToolError } from "../lib/mcp-error.js";
import { parseToolInput, requireScope, structuredToolResult } from "./shared.js";
import type { ToolHandler } from "./types.js";

const TOOL_NAME = "remarks_batch_update_status" as const;

// Cap parallel API calls so a max-size batch (50) doesn't fan out as 50
// simultaneous internal HTTP requests. 8 is a comfortable upper bound for
// the Fly internal VPC hop and Postgres connection pool.
const CONCURRENCY = 8;

// Spec §3.2: partial-failure semantics. A failed individual update does NOT
// fail the call — it surfaces as `{success: false, error}` in its result row.
// Only top-level failures (Zod, scope, idempotency conflict) throw.
export const batchUpdateStatusHandler: ToolHandler = async (args, ctx) => {
  const input = parseToolInput(batchUpdateStatusInputSchema, args, TOOL_NAME);
  requireScope(ctx.auth, "tasks:write", TOOL_NAME);

  const idemPayload = { updates: input.updates };

  if (input.idempotency_key) {
    const cached = await ctx.idempotency.check<BatchUpdateStatusOutput>({
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

  // Result slot is preallocated by index so chunked execution can write
  // results into the right position without coordination.
  const results: BatchUpdateStatusOutput["results"] = new Array(input.updates.length);

  for (let chunkStart = 0; chunkStart < input.updates.length; chunkStart += CONCURRENCY) {
    const chunk = input.updates.slice(chunkStart, chunkStart + CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map((u) =>
        ctx.api.updateAnnotationStatus(
          u.task_id,
          ctx.auth.clerkUserId,
          ctx.auth.oauthClientName,
          u.status,
          u.note,
          u.reason
        )
      )
    );
    settled.forEach((outcome, i) => {
      const update = chunk[i];
      // Loop bound guarantees the slice index exists; satisfy strict TS
      // narrowing in one place rather than at every result write.
      if (!update) return;
      const slot = chunkStart + i;
      if (outcome.status === "fulfilled") {
        if (outcome.value === null) {
          results[slot] = {
            task_id: update.task_id,
            success: false,
            error: "Task not found",
          };
        } else {
          results[slot] = { task_id: update.task_id, success: true };
        }
      } else {
        // Reason is the InternalError thrown by api-client on non-2xx (other
        // than 404). Surface its message so the agent has a hint without
        // leaking server internals — `InternalError.message` is the label
        // we constructed in api-client.
        const reason = outcome.reason;
        const message =
          reason instanceof Error && reason.message ? reason.message : "Internal error";
        results[slot] = { task_id: update.task_id, success: false, error: message };
      }
    });
  }

  const output = batchUpdateStatusOutputSchema.parse({ results });

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
