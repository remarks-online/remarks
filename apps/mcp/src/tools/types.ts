import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as apiClient from "../lib/api-client.js";
import type { IdempotencyCache } from "../lib/idempotency.js";
import type { AuthContext } from "../types/auth.js";

// Module-level api-client surface as a typed handle. Each tool reaches for
// the methods it needs via `ctx.api.fetch...`; tests replace this with a
// vi.mock so handlers don't make real network calls.
export interface ApiClient {
  assertProjectAccess: typeof apiClient.assertProjectAccess;
  listAccessibleProjects: typeof apiClient.listAccessibleProjects;
  assertOrgAccess: typeof apiClient.assertOrgAccess;
  listAccessibleOrgs: typeof apiClient.listAccessibleOrgs;
  fetchWhoami: typeof apiClient.fetchWhoami;
  fetchProjectContext: typeof apiClient.fetchProjectContext;
  fetchListAnnotations: typeof apiClient.fetchListAnnotations;
  fetchListPersonalAnnotations: typeof apiClient.fetchListPersonalAnnotations;
  fetchListOrgAnnotations: typeof apiClient.fetchListOrgAnnotations;
  fetchAnnotation: typeof apiClient.fetchAnnotation;
  updateAnnotationStatus: typeof apiClient.updateAnnotationStatus;
  addAnnotationComment: typeof apiClient.addAnnotationComment;
}

// Per-request context threaded into every tool handler. Built once in
// routes/mcp.ts after the auth plugin populates `request.auth`. The
// idempotency cache is shared (a Redis-backed instance) but treated as an
// injectable so tests can pass an in-memory fake.
export interface ToolHandlerContext {
  auth: AuthContext;
  api: ApiClient;
  idempotency: IdempotencyCache;
  requestId: string;
}

export type ToolHandler = (args: unknown, ctx: ToolHandlerContext) => Promise<CallToolResult>;
