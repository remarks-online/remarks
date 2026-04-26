import { openPrInputSchema, openPrOutputSchema } from "@remarks/mcp-schema";
import { McpToolError } from "../lib/mcp-error.js";
import { parseToolInput, requireScope, structuredToolResult } from "./shared.js";
import type { ToolHandler } from "./types.js";

const TOOL_NAME = "remarks_open_pr" as const;

const PENDING_MESSAGE =
  "GitHub integration ships in Phase 3. Your changes have been logged but no PR has been created.";

// Phase 2 §3.2: stub. Always returns `pending_github_integration`. No DB
// write, no internal API call, no idempotency cache — the response is
// constant per (project, scope) and Phase 3 replaces this handler entirely.
// Adding cache plumbing now would migrate to a different shape later for zero
// benefit. Scope gate stays so fine-grained scopes are honored when they
// ship.
export const openPrHandler: ToolHandler = async (args, ctx) => {
  const input = parseToolInput(openPrInputSchema, args, TOOL_NAME);
  requireScope(ctx.auth, "tasks:write", TOOL_NAME);

  // Cross-project access is 404 (existence not leaked, same as get_task).
  if (input.project_id !== ctx.auth.projectId) {
    throw new McpToolError("NOT_FOUND", "Project not found");
  }

  const output = openPrOutputSchema.parse({
    status: "pending_github_integration",
    pr_url: null,
    message: PENDING_MESSAGE,
  });
  return structuredToolResult(output);
};
