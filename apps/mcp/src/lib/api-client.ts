import type { AgentUpdateStatus, McpCommentKind } from "@remarks/mcp-schema";
import {
  type AnnotationListResponse,
  type AnnotationResponse,
  type AnnotationStatus,
  InternalError,
} from "@remarks/shared";
import { env } from "../env.js";

// --- Internal API helpers ---
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

// --- Membership / authorization (ADR-0015) ---
//
// Replaces the old token-resolve mechanism. Auth is "you are this Clerk user;
// can you see this project?" — answered against project_members.

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
}

// Lists every project the Clerk user can see. Backs `remarks_whoami` and
// warms the per-user membership cache.
export async function listAccessibleProjects(clerkUserId: string): Promise<ProjectSummary[]> {
  const result = await getJson<{ projects: ProjectSummary[] }>(
    `/internal/users/${encodeURIComponent(clerkUserId)}/projects`,
    "accessible projects"
  );
  return result?.projects ?? [];
}

// Returns true iff the user is a member of the project. Used as the
// per-tool-call authorization gate for any tool that takes a project_id (or
// resolves to one via task_id). 404 → false.
export async function assertProjectAccess(
  clerkUserId: string,
  projectId: string
): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch(
      `${env.API_INTERNAL_URL}/internal/users/${encodeURIComponent(clerkUserId)}/projects/${encodeURIComponent(projectId)}`,
      { method: "GET", headers: { "x-internal-auth": env.INTERNAL_API_TOKEN } }
    );
  } catch (cause) {
    throw new InternalError("Failed to reach Remarks API for project access check", cause);
  }
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new InternalError(`project access check failed with status ${response.status}`);
  }
  return true;
}

// --- Org membership ---

export interface OrgSummary {
  id: string;
  clerkOrgId: string;
  name: string;
  slug: string;
  role: string;
}

// Lists every org the Clerk user belongs to. Backs `remarks_whoami`'s `orgs`
// field; lets agents discover org IDs without first poking at the dashboard.
export async function listAccessibleOrgs(clerkUserId: string): Promise<OrgSummary[]> {
  const result = await getJson<{ orgs: OrgSummary[] }>(
    `/internal/users/${encodeURIComponent(clerkUserId)}/orgs`,
    "accessible orgs"
  );
  return result?.orgs ?? [];
}

// Returns true iff the user belongs to the org. `orgId` is the Remarks UUID
// (organizations.id) — the same id surfaced by `remarks_whoami` and accepted by
// `remarks_list_tasks` in org mode. 404 → false (existence-leak posture).
export async function assertOrgAccess(clerkUserId: string, orgId: string): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch(
      `${env.API_INTERNAL_URL}/internal/users/${encodeURIComponent(clerkUserId)}/orgs/${encodeURIComponent(orgId)}`,
      { method: "GET", headers: { "x-internal-auth": env.INTERNAL_API_TOKEN } }
    );
  } catch (cause) {
    throw new InternalError("Failed to reach Remarks API for org access check", cause);
  }
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new InternalError(`org access check failed with status ${response.status}`);
  }
  return true;
}

// --- Whoami / project context / annotation reads ---

export interface UserSummary {
  id: string;
  email: string | null;
  name: string | null;
}

export interface WhoamiPayload {
  user: UserSummary;
  projects: ProjectSummary[];
}

export async function fetchWhoami(clerkUserId: string): Promise<WhoamiPayload | null> {
  return getJson<WhoamiPayload>(
    `/internal/mcp/whoami/${encodeURIComponent(clerkUserId)}`,
    "whoami lookup"
  );
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

// Personal-mode list params: branch is project-specific, so it's not accepted.
export interface ListUserAnnotationsParams {
  statuses?: string[];
  limit?: number;
  cursor?: string;
}

function buildUserListQuery(params: ListUserAnnotationsParams): string {
  const search = new URLSearchParams();
  if (params.statuses && params.statuses.length > 0) {
    search.set("statuses", params.statuses.join(","));
  }
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.cursor !== undefined) search.set("cursor", params.cursor);
  return search.size > 0 ? `?${search.toString()}` : "";
}

export async function fetchListPersonalAnnotations(
  clerkUserId: string,
  params: ListUserAnnotationsParams
): Promise<AnnotationListResponse | null> {
  return getJson<AnnotationListResponse>(
    `/internal/mcp/users/${encodeURIComponent(clerkUserId)}/personal-annotations${buildUserListQuery(params)}`,
    "personal annotation list"
  );
}

export async function fetchListOrgAnnotations(
  clerkUserId: string,
  orgId: string,
  params: ListUserAnnotationsParams
): Promise<AnnotationListResponse | null> {
  return getJson<AnnotationListResponse>(
    `/internal/mcp/users/${encodeURIComponent(clerkUserId)}/orgs/${encodeURIComponent(orgId)}/annotations${buildUserListQuery(params)}`,
    "org annotation list"
  );
}

export interface McpDomContextRow {
  tagName?: string;
  classes?: string[];
  textContent?: string;
  computedStyles?: Record<string, string>;
  ancestors?: Array<{ tagName: string; classes?: string[] }>;
}

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
  clerkUserId: string
): Promise<McpAnnotationPayload | null> {
  return getJson<McpAnnotationPayload>(
    `/internal/mcp/annotations/${annotationId}?clerkUserId=${encodeURIComponent(clerkUserId)}`,
    "annotation lookup"
  );
}

// --- Mutation fetchers (Phase 2 tasks 2.10–2.11; ADR-0015 attribution model) ---
//
// Auth-context attribution moves from token id → (Clerk user id, OAuth client
// name). The API records actor_id (FK → users) and actor_oauth_client_id
// (text) on the annotation_events row.

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
  clerkUserId: string,
  oauthClientName: string,
  status: AgentUpdateStatus,
  note: string | undefined
): Promise<UpdateAnnotationStatusPayload | null> {
  return postJson<
    {
      clerkUserId: string;
      oauthClientName: string;
      status: AgentUpdateStatus;
      note?: string;
    },
    UpdateAnnotationStatusPayload
  >(
    `/internal/mcp/annotations/${annotationId}/status`,
    {
      clerkUserId,
      oauthClientName,
      status,
      ...(note !== undefined ? { note } : {}),
    },
    "agent status update"
  );
}

export interface AddAnnotationCommentPayload {
  eventId: string;
  createdAt: string;
}

export async function addAnnotationComment(
  annotationId: string,
  clerkUserId: string,
  oauthClientName: string,
  comment: string,
  kind: McpCommentKind | undefined
): Promise<AddAnnotationCommentPayload | null> {
  return postJson<
    {
      clerkUserId: string;
      oauthClientName: string;
      comment: string;
      kind?: McpCommentKind;
    },
    AddAnnotationCommentPayload
  >(
    `/internal/mcp/annotations/${annotationId}/comments`,
    {
      clerkUserId,
      oauthClientName,
      comment,
      ...(kind !== undefined ? { kind } : {}),
    },
    "agent comment"
  );
}
