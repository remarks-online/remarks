import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ZodType } from "zod";
import { McpToolError } from "../lib/mcp-error.js";
import type { AuthContext } from "../types/auth.js";
import type { ApiClient } from "./types.js";

// Spec §3.2 list_tasks comment_preview: "first 120 chars". Same length is
// reused for `related_tasks.comment_preview` in get_task — both are summaries
// of the same `commentText` field.
export const COMMENT_PREVIEW_LENGTH = 120;

export function commentPreview(text: string): string {
  if (text.length <= COMMENT_PREVIEW_LENGTH) return text;
  return text.slice(0, COMMENT_PREVIEW_LENGTH);
}

// Phase 2 spec §3.2 task author = { name, email } (both required strings).
// The internal AnnotationResponse author has nullable name/email (deleted
// users get null fields per packages/shared/src/schemas/annotation.ts:84).
// Fallbacks keep the MCP wire shape valid without leaking deletion state to
// agents (they don't act on author identity).
export function projectAuthor(input: { name: string | null; email: string | null }): {
  name: string;
  email: string;
} {
  const email = input.email ?? "";
  const name = input.name ?? input.email ?? "Unknown";
  return { name, email };
}

// Validate the agent's input against the tool's Zod schema. A failure here
// is the agent's bug — surface it as VALIDATION_ERROR with the Zod issues
// (Phase 2 spec §3.3) so the agent can self-correct.
export function parseToolInput<T>(schema: ZodType<T>, args: unknown, context: string): T {
  const result = schema.safeParse(args ?? {});
  if (!result.success) {
    throw new McpToolError("VALIDATION_ERROR", `Invalid input for ${context}`, {
      details: result.error.issues,
    });
  }
  return result.data;
}

// Phase 2 spec §5.2: every Phase 2 token has all three scopes today. Enforcing
// per-tool now means fine-grained scopes can ship later without touching
// handlers — only the OAuth-app scope catalog in Clerk.
export function requireScope(auth: AuthContext, scope: string, tool: string): void {
  if (!auth.scopes.includes(scope)) {
    throw new McpToolError("FORBIDDEN", `Tool ${tool} requires scope ${scope}`);
  }
}

// ADR-0015 §5.2: per-tool authorization gate. Tools that target a project
// (or a task that resolves to one) call this before reading or mutating.
// Cross-project access surfaces as NOT_FOUND so existence isn't leaked,
// matching the user-auth REST path's `requireProjectMember` posture.
export async function requireProjectAccess(
  auth: AuthContext,
  api: ApiClient,
  projectId: string
): Promise<void> {
  const allowed = await api.assertProjectAccess(auth.clerkUserId, projectId);
  if (!allowed) {
    throw new McpToolError("NOT_FOUND", "Project not found");
  }
}

// Wrap a structured payload into the SDK's CallToolResult envelope. Modern
// clients read `structuredContent`; the JSON-text content is a fallback for
// clients that haven't adopted structuredContent yet (still in the spec for
// 2025-06-18 transport compatibility).
export function structuredToolResult<T>(payload: T): CallToolResult {
  const json = JSON.stringify(payload);
  return {
    content: [{ type: "text", text: json }],
    structuredContent: payload as Record<string, unknown>,
  };
}
