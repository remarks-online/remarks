import { getProjectContextInputSchema, getProjectContextOutputSchema } from "@remarks/mcp-schema";
import { McpToolError } from "../lib/mcp-error.js";
import { parseToolInput, structuredToolResult } from "./shared.js";
import type { ToolHandler } from "./types.js";

export const getProjectContextHandler: ToolHandler = async (args, ctx) => {
  const input = parseToolInput(getProjectContextInputSchema, args, "remarks_get_project_context");

  if (input.project_id !== ctx.auth.projectId) {
    throw new McpToolError("NOT_FOUND", "Project not found");
  }

  const payload = await ctx.api.fetchProjectContext(input.project_id);
  if (!payload) {
    throw new McpToolError("NOT_FOUND", "Project not found");
  }

  const output = getProjectContextOutputSchema.parse({
    project: {
      id: payload.project.id,
      name: payload.project.name,
      slug: payload.project.slug,
      primary_branch: payload.project.primaryBranch,
      git_repo_url: payload.project.gitRepoUrl,
    },
    active_branches: payload.activeBranches.map((b) => ({
      name: b.name,
      open_task_count: b.openTaskCount,
      last_activity: b.lastActivity,
    })),
    // Phase 2 spec §3.2: reserved field, always null until year-2 design-system integration.
    design_tokens: null,
  });
  return structuredToolResult(output);
};
