// Resolved auth state attached to every authenticated MCP request.
// Tools (tasks 2.6+) consume `projectId` to gate access and `scopes` to
// gate write operations. `tokenId` is for audit/event attribution
// (annotation_events.actor_token_id when an agent mutates state).
export interface AuthContext {
  tokenId: string;
  projectId: string;
  scopes: string[];
}
