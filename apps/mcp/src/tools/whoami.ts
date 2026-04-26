import { whoamiInputSchema, whoamiOutputSchema } from "@remarks/mcp-schema";
import { McpToolError } from "../lib/mcp-error.js";
import { SKILL_VERSION } from "../skill/version.js";
import { SERVER_VERSION } from "../version.js";
import { parseToolInput, structuredToolResult } from "./shared.js";
import type { ToolHandler } from "./types.js";

// remarks_whoami — Phase 2 spec §3.2 Health, ADR-0015. Cheap probe the agent
// calls at session start to confirm "I'm connected; here's the user and the
// projects I can act on." Under the OAuth model one grant covers every
// project the Clerk user is a member of, so the response is plural.
export const whoamiHandler: ToolHandler = async (args, ctx) => {
  parseToolInput(whoamiInputSchema, args, "remarks_whoami");

  const payload = await ctx.api.fetchWhoami(ctx.auth.clerkUserId);
  if (!payload) {
    // The token verified (we got past the auth middleware) but the user has
    // no row in our DB yet — Clerk webhook lag. Surface as NOT_FOUND so the
    // agent stops calling tools instead of retrying tightly.
    throw new McpToolError("NOT_FOUND", "User not found");
  }

  const output = whoamiOutputSchema.parse({
    user: {
      id: payload.user.id,
      email: payload.user.email,
      name: payload.user.name,
    },
    projects: payload.projects,
    oauth_client_name: ctx.auth.oauthClientName,
    granted_scopes: ctx.auth.scopes,
    server_version: SERVER_VERSION,
    skill_version: SKILL_VERSION,
  });
  return structuredToolResult(output);
};
