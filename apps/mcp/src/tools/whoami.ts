import { whoamiInputSchema, whoamiOutputSchema } from "@remarks/mcp-schema";
import { McpToolError } from "../lib/mcp-error.js";
import { SKILL_VERSION } from "../skill/version.js";
import { SERVER_VERSION } from "../version.js";
import { parseToolInput, structuredToolResult } from "./shared.js";
import type { ToolHandler } from "./types.js";

// remarks_whoami — Phase 2 spec §3.2 Health, ADR-0015. Cheap probe the agent
// calls at session start to confirm "I'm connected; here's the user, the
// projects I can act on, and the orgs they can roll up to." Under the OAuth
// model one grant covers every project the Clerk user is a member of and
// every org they belong to, so both lists are plural. Fans out to projects
// and orgs in parallel.
export const whoamiHandler: ToolHandler = async (args, ctx) => {
  parseToolInput(whoamiInputSchema, args, "remarks_whoami");

  const [payload, orgs] = await Promise.all([
    ctx.api.fetchWhoami(ctx.auth.clerkUserId),
    ctx.api.listAccessibleOrgs(ctx.auth.clerkUserId),
  ]);
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
    orgs: orgs.map((o) => ({
      id: o.id,
      clerk_org_id: o.clerkOrgId,
      name: o.name,
      slug: o.slug,
      role: o.role,
    })),
    oauth_client_name: ctx.auth.oauthClientName,
    granted_scopes: ctx.auth.scopes,
    server_version: SERVER_VERSION,
    skill_version: SKILL_VERSION,
  });
  return structuredToolResult(output);
};
