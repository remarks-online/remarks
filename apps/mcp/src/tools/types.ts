import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as apiClient from "../lib/api-client.js";
import type { AuthContext } from "../types/auth.js";

// Module-level api-client surface as a typed handle. Each tool reaches for
// the methods it needs via `ctx.api.fetch...`; tests replace this with a
// vi.mock so handlers don't make real network calls.
export interface ApiClient {
  fetchWhoami: typeof apiClient.fetchWhoami;
  fetchProjectContext: typeof apiClient.fetchProjectContext;
  fetchListAnnotations: typeof apiClient.fetchListAnnotations;
  fetchAnnotation: typeof apiClient.fetchAnnotation;
}

// Per-request context threaded into every tool handler. Built once in
// routes/mcp.ts after the auth plugin populates `request.auth`.
export interface ToolHandlerContext {
  auth: AuthContext;
  api: ApiClient;
  requestId: string;
}

export type ToolHandler = (args: unknown, ctx: ToolHandlerContext) => Promise<CallToolResult>;
