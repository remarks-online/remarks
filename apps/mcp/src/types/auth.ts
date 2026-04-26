// Resolved auth state attached to every authenticated MCP request.
// Populated by the JWT-verifying auth plugin (apps/mcp/src/plugins/mcp-auth.ts)
// after a successful Clerk-issued token validation.
//
// `clerkUserId`: Clerk's `sub` claim. Used for project-membership lookups and
//   audit attribution (annotation_events.actor_id resolves through users).
// `scopes`: granted OAuth scopes (`tasks:read`, `tasks:write`, `project:read`).
// `oauthClientName`: human-readable name of the OAuth app the token was
//   issued to — captured at DCR time. Used for event attribution
//   (annotation_events.actor_oauth_client_id, e.g. "Claude Code", "Cursor").
export interface AuthContext {
  clerkUserId: string;
  scopes: string[];
  oauthClientName: string;
}
