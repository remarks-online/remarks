import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { REMARKS_TOOLS, type RemarksTool, type RemarksToolName } from "@remarks/mcp-schema";
import { z } from "zod";
import { McpToolError, toMcpToolErrorPayload } from "../lib/mcp-error.js";
import { acknowledgeHandler } from "./acknowledge.js";
import { addTaskCommentHandler } from "./add-task-comment.js";
import { batchUpdateStatusHandler } from "./batch-update-status.js";
import { dismissHandler } from "./dismiss.js";
import { getAllPendingHandler } from "./get-all-pending.js";
import { getPendingHandler } from "./get-pending.js";
import { getProjectContextHandler } from "./get-project-context.js";
import { getTaskHandler } from "./get-task.js";
import { listTasksHandler } from "./list-tasks.js";
import { openPrHandler } from "./open-pr.js";
import type { ToolHandler, ToolHandlerContext } from "./types.js";
import { updateTaskStatusHandler } from "./update-task-status.js";
import { whoamiHandler } from "./whoami.js";

// All eight tools wired. The mutators + open_pr stub shipped in tasks
// 2.10–2.13. Phase 2 spec §3.1: tool names are stable; new capability is a
// new tool, not a rename — so this map only ever grows. Unimplemented tool
// names still flow through the not-yet-implemented branch below for
// forward-compat, but every name in @remarks/mcp-schema is now bound.
const HANDLERS: Partial<Record<RemarksToolName, ToolHandler>> = {
  remarks_whoami: whoamiHandler,
  remarks_list_tasks: listTasksHandler,
  remarks_get_task: getTaskHandler,
  remarks_get_project_context: getProjectContextHandler,
  remarks_update_task_status: updateTaskStatusHandler,
  remarks_add_task_comment: addTaskCommentHandler,
  remarks_acknowledge: acknowledgeHandler,
  remarks_dismiss: dismissHandler,
  remarks_get_pending: getPendingHandler,
  remarks_get_all_pending: getAllPendingHandler,
  remarks_batch_update_status: batchUpdateStatusHandler,
  remarks_open_pr: openPrHandler,
};

function toToolManifest(tool: RemarksTool): Tool {
  // Zod 4's built-in JSON Schema generation. The MCP SDK validates the
  // returned `inputSchema` against its own `inputSchema` shape (object with
  // type:"object", properties, required) — Zod's draft-7 output matches.
  const inputSchema = z.toJSONSchema(tool.input, { target: "draft-7" });
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: inputSchema as Tool["inputSchema"],
  };
}

export function registerToolHandlers(server: Server, ctx: ToolHandlerContext): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: REMARKS_TOOLS.map(toToolManifest),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name as RemarksToolName;
    const handler = HANDLERS[name];

    try {
      if (!handler) {
        // Tool advertised in the manifest but not yet implemented (mutators
        // ship in tasks 2.10–2.13). Phase 2 spec §3.1 keeps tool names stable;
        // we don't drop them from `tools/list` just because the body isn't
        // wired.
        if (!REMARKS_TOOLS.some((t) => t.name === name)) {
          throw new McpToolError("VALIDATION_ERROR", `Unknown tool: ${name}`);
        }
        throw new McpToolError("INTERNAL", `Tool ${name} not yet implemented`);
      }
      return await handler(request.params.arguments, ctx);
    } catch (err) {
      if (err instanceof McpToolError) {
        const payload = toMcpToolErrorPayload(err, ctx.requestId);
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: payload }) }],
          structuredContent: { error: payload },
        };
      }
      // Programmer error / infra failure — bubble to the SDK so the client
      // sees a JSON-RPC `-32603 Internal error` rather than swallowing it.
      throw err;
    }
  });
}
