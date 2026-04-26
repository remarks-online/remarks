import type { AgentUpdateStatus, McpCommentKind } from "@remarks/mcp-schema";
import {
  type AnnotationListResponse,
  type AnnotationResponse,
  type AnnotationStatus,
  InternalError,
} from "@remarks/shared";
import { env } from "../env.js";
import type { AuthContext } from "../types/auth.js";

const RESOLVE_PATH = "/internal/mcp/tokens/resolve";

// Calls the API's internal token-resolution endpoint (task 2.5). Returns the
// resolved auth context on a 200, `null` on a 404 (unknown / expired /
// revoked — the API decides which qualifies). Anything else is a transport or
// upstream bug; the auth plugin lets it bubble out as a 500.
export async function resolveToken(tokenHash: string): Promise<AuthContext | null> {
  let response: Response;
  try {
    response = await fetch(`${env.API_INTERNAL_URL}${RESOLVE_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-auth": env.INTERNAL_API_TOKEN,
      },
      body: JSON.stringify({ tokenHash }),
    });
  } catch (cause) {
    throw new InternalError("Failed to reach Remarks API for token resolution", cause);
  }

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new InternalError(`Token resolution failed with status ${response.status}`);
  }

  const body = (await response.json()) as AuthContext;
  return body;
}

// --- Read-tool fetchers (Phase 2 tasks 2.6–2.9) ---
//
// Each maps 1:1 to a `/internal/mcp/...` endpoint defined in apps/api. They
// return `null` on 404 so the calling tool handler can throw a tagged
// `McpToolError("NOT_FOUND", ...)` instead of surfacing raw HTTP statuses to
// the agent. Any other non-2xx is treated as an upstream bug and bubbles to
// JSON-RPC -32603.

async function getJson<T>(path: string, label: string): Promise<T | null> {
  let response: Response;
  try {
    response = await fetch(`${env.API_INTERNAL_URL}${path}`, {
      method: "GET",
      headers: { "x-internal-auth": env.INTERNAL_API_TOKEN },
    });
  } catch (cause) {
    throw new InternalError(`Failed to reach Remarks API for ${label}`, cause);
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new InternalError(`${label} failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

export interface WhoamiPayload {
  token: { id: string; name: string; scopes: string[] };
  project: { id: string; name: string; slug: string };
}

export async function fetchWhoami(tokenId: string): Promise<WhoamiPayload | null> {
  return getJson<WhoamiPayload>(`/internal/mcp/whoami/${tokenId}`, "whoami lookup");
}

export interface ProjectContextPayload {
  project: {
    id: string;
    name: string;
    slug: string;
    primaryBranch: string;
    gitRepoUrl: string | null;
  };
  activeBranches: Array<{
    name: string;
    openTaskCount: number;
    lastActivity: string;
  }>;
}

export async function fetchProjectContext(
  projectId: string
): Promise<ProjectContextPayload | null> {
  return getJson<ProjectContextPayload>(
    `/internal/mcp/projects/${projectId}/context`,
    "project context"
  );
}

export interface ListAnnotationsParams {
  statuses?: string[];
  branch?: string;
  limit?: number;
  cursor?: string;
}

export async function fetchListAnnotations(
  projectId: string,
  params: ListAnnotationsParams
): Promise<AnnotationListResponse | null> {
  const search = new URLSearchParams();
  if (params.statuses && params.statuses.length > 0) {
    search.set("statuses", params.statuses.join(","));
  }
  if (params.branch !== undefined) search.set("branch", params.branch);
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.cursor !== undefined) search.set("cursor", params.cursor);
  const query = search.size > 0 ? `?${search.toString()}` : "";
  return getJson<AnnotationListResponse>(
    `/internal/mcp/projects/${projectId}/annotations${query}`,
    "annotation list"
  );
}

export interface McpDomContextRow {
  tagName?: string;
  classes?: string[];
  textContent?: string;
  computedStyles?: Record<string, string>;
  ancestors?: Array<{ tagName: string; classes?: string[] }>;
}

// MCP-specific annotation shape: the dashboard's AnnotationResponse omits
// domContext + frameworkHint (they're only useful to agents); the internal
// /internal/mcp/annotations/:id endpoint returns this extended shape.
export interface McpAnnotationRow extends AnnotationResponse {
  domContext: McpDomContextRow | null;
  frameworkHint: string | null;
}

export interface McpAnnotationPayload {
  annotation: McpAnnotationRow;
  relatedTasks: Array<{
    id: string;
    status: AnnotationResponse["status"];
    commentText: string;
  }>;
}

export async function fetchAnnotation(
  annotationId: string,
  projectId: string
): Promise<McpAnnotationPayload | null> {
  return getJson<McpAnnotationPayload>(
    `/internal/mcp/annotations/${annotationId}?projectId=${projectId}`,
    "annotation lookup"
  );
}

// --- Mutation fetchers (Phase 2 tasks 2.10–2.11) ---
//
// Same null-on-404 / throw-on-other-non-2xx contract as `getJson`. The 2xx
// surface is split: 200 for status updates (UPDATE then read), 201 for new
// comment events. Both succeed-shapes are accepted; anything else throws.

async function postJson<TReq, TRes>(path: string, body: TReq, label: string): Promise<TRes | null> {
  let response: Response;
  try {
    response = await fetch(`${env.API_INTERNAL_URL}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-auth": env.INTERNAL_API_TOKEN,
      },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new InternalError(`Failed to reach Remarks API for ${label}`, cause);
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new InternalError(`${label} failed with status ${response.status}`);
  }
  return (await response.json()) as TRes;
}

export interface UpdateAnnotationStatusPayload {
  id: string;
  status: AnnotationStatus;
  updatedAt: string;
}

export async function updateAnnotationStatus(
  annotationId: string,
  projectId: string,
  tokenId: string,
  status: AgentUpdateStatus,
  note: string | undefined
): Promise<UpdateAnnotationStatusPayload | null> {
  return postJson<
    { projectId: string; tokenId: string; status: AgentUpdateStatus; note?: string },
    UpdateAnnotationStatusPayload
  >(
    `/internal/mcp/annotations/${annotationId}/status`,
    { projectId, tokenId, status, ...(note !== undefined ? { note } : {}) },
    "agent status update"
  );
}

export interface AddAnnotationCommentPayload {
  eventId: string;
  createdAt: string;
}

export async function addAnnotationComment(
  annotationId: string,
  projectId: string,
  tokenId: string,
  comment: string,
  kind: McpCommentKind | undefined
): Promise<AddAnnotationCommentPayload | null> {
  return postJson<
    { projectId: string; tokenId: string; comment: string; kind?: McpCommentKind },
    AddAnnotationCommentPayload
  >(
    `/internal/mcp/annotations/${annotationId}/comments`,
    { projectId, tokenId, comment, ...(kind !== undefined ? { kind } : {}) },
    "agent comment"
  );
}
