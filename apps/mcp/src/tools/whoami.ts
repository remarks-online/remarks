import { whoamiInputSchema, whoamiOutputSchema } from "@remarks/mcp-schema";
import { McpToolError } from "../lib/mcp-error.js";
import { SKILL_VERSION } from "../skill/version.js";
import { SERVER_VERSION } from "../version.js";
import { parseToolInput, structuredToolResult } from "./shared.js";
import type { ToolHandler } from "./types.js";

// remarks_whoami — Phase 2 spec §3.2 Health. Cheap, side-effect-free probe
// the agent calls at session start to confirm "I'm connected to project
// X with scopes Y." server_version + skill_version let the agent detect
// when either has updated since the last connection.
export const whoamiHandler: ToolHandler = async (args, ctx) => {
  parseToolInput(whoamiInputSchema, args, "remarks_whoami");

  const payload = await ctx.api.fetchWhoami(ctx.auth.tokenId);
  if (!payload) {
    // The bearer token resolved (we got past the auth middleware) but the
    // backing token row vanished or got revoked between cache TTLs. Surface
    // as NOT_FOUND so the agent stops calling tools instead of retrying.
    throw new McpToolError("NOT_FOUND", "Token not found");
  }

  const output = whoamiOutputSchema.parse({
    project: {
      id: payload.project.id,
      name: payload.project.name,
      slug: payload.project.slug,
    },
    token_name: payload.token.name,
    token_scopes: payload.token.scopes,
    server_version: SERVER_VERSION,
    skill_version: SKILL_VERSION,
  });
  return structuredToolResult(output);
};
