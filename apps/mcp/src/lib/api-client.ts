import type { AgentUpdateStatus, McpCommentKind } from "@remarks/mcp-schema";
import {
  type AnnotationEventType,
  type AnnotationIntent,
  type AnnotationListResponse,
  type AnnotationResponse,
  type AnnotationSeverity,
  type AnnotationStatus,
  type AnnotationStreamEvent,
  type EventActorType,
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

// G8b: cross-scope (personal + every member project, regardless of org). Backs
// `remarks_get_all_pending`. Mirrors the personal/org helpers above.
export async function fetchListAllAnnotations(
  clerkUserId: string,
  params: ListUserAnnotationsParams
): Promise<AnnotationListResponse | null> {
  return getJson<AnnotationListResponse>(
    `/internal/mcp/users/${encodeURIComponent(clerkUserId)}/all-annotations${buildUserListQuery(params)}`,
    "all annotation list"
  );
}

export interface McpAnnotationRow extends AnnotationResponse {
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
  note: string | undefined,
  reason: string | undefined
): Promise<UpdateAnnotationStatusPayload | null> {
  return postJson<
    {
      clerkUserId: string;
      oauthClientName: string;
      status: AgentUpdateStatus;
      note?: string;
      reason?: string;
    },
    UpdateAnnotationStatusPayload
  >(
    `/internal/mcp/annotations/${annotationId}/status`,
    {
      clerkUserId,
      oauthClientName,
      status,
      ...(note !== undefined ? { note } : {}),
      ...(reason !== undefined ? { reason } : {}),
    },
    "agent status update"
  );
}

export interface AddAnnotationCommentPayload {
  eventId: string;
  createdAt: string;
}

// G10: long-poll watch payload. Mirrors the API's WatchResponseBody (see
// apps/api/src/routes/internal/watch.ts). The MCP tool projects this into
// the snake_case wire shape; this stays camelCase to match every other
// internal-API helper in this file.
export interface WatchEventPayload {
  streamEvent: AnnotationStreamEvent;
  // Null when the underlying annotation no longer exists (e.g. on a
  // deletion event). MCP wire shape carries the same nullability.
  annotation: (AnnotationResponse & { frameworkHint: string | null }) | null;
  autoAcknowledged: boolean;
}

export interface WatchAnnotationsPayload {
  events: WatchEventPayload[];
  nextCursor: string | null;
  idle: boolean;
  replayTruncated: boolean;
  moreAvailable: boolean;
}

// Filters / knobs that the watch endpoint accepts. All optional — omit for
// "no filter on this axis." `eventTypes` and `statuses` accept arrays;
// they're CSV-encoded into the query string here so the API's Zod query
// schema can re-parse them with its `csvList` helper.
export interface WatchAnnotationsScope {
  // Exactly one of these.
  projectId?: string;
  userMode?: { mode: "personal" | "all" | "org"; orgId?: string };
}

export interface WatchAnnotationsParams extends WatchAnnotationsScope {
  clerkUserId: string;
  oauthClientName: string;
  since?: string;
  intents?: AnnotationIntent[];
  severities?: AnnotationSeverity[];
  statuses?: AnnotationStatus[];
  eventTypes?: AnnotationEventType[];
  branch?: string;
  waitSeconds?: number;
  batchWindowMs?: number;
  limit?: number;
  autoAcknowledge?: boolean;
}

function buildWatchQuery(params: WatchAnnotationsParams): URLSearchParams {
  const search = new URLSearchParams();
  if (params.since !== undefined) search.set("since", params.since);
  if (params.intents && params.intents.length > 0) search.set("intent", params.intents.join(","));
  if (params.severities && params.severities.length > 0) {
    search.set("severity", params.severities.join(","));
  }
  if (params.statuses && params.statuses.length > 0) {
    search.set("status", params.statuses.join(","));
  }
  if (params.eventTypes && params.eventTypes.length > 0) {
    search.set("event_types", params.eventTypes.join(","));
  }
  if (params.branch !== undefined) search.set("branch", params.branch);
  if (params.waitSeconds !== undefined) search.set("wait_seconds", String(params.waitSeconds));
  if (params.batchWindowMs !== undefined) {
    search.set("batch_window_ms", String(params.batchWindowMs));
  }
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.autoAcknowledge !== undefined) {
    search.set("auto_acknowledge", String(params.autoAcknowledge));
  }
  // oauthClientName is required when auto_acknowledge is on; the API enforces
  // the pairing, but always send it for consistency with the other mutation
  // helpers (no harm when unused).
  search.set("oauthClientName", params.oauthClientName);
  return search;
}

export async function fetchWatchAnnotations(
  params: WatchAnnotationsParams
): Promise<WatchAnnotationsPayload | null> {
  const search = buildWatchQuery(params);
  let url: string;
  if (params.projectId !== undefined) {
    search.set("clerkUserId", params.clerkUserId);
    url = `${env.API_INTERNAL_URL}/internal/mcp/projects/${encodeURIComponent(params.projectId)}/watch?${search.toString()}`;
  } else if (params.userMode !== undefined) {
    search.set("mode", params.userMode.mode);
    if (params.userMode.orgId !== undefined) search.set("orgId", params.userMode.orgId);
    url = `${env.API_INTERNAL_URL}/internal/mcp/users/${encodeURIComponent(params.clerkUserId)}/watch?${search.toString()}`;
  } else {
    throw new InternalError("watch params must set projectId or userMode");
  }

  // Per-call AbortController with a margin past the request's wait deadline.
  // Without it, a network blip on the API side would leave the MCP request
  // hanging until the proxy times it out.
  const margin = 10;
  const waitSeconds = params.waitSeconds ?? 30;
  const ac = new AbortController();
  const timeoutHandle = setTimeout(() => ac.abort(), (waitSeconds + margin) * 1000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "x-internal-auth": env.INTERNAL_API_TOKEN },
      signal: ac.signal,
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new InternalError(`watch annotations failed with status ${response.status}`);
    }
    return (await response.json()) as WatchAnnotationsPayload;
  } catch (cause) {
    if (cause instanceof InternalError) throw cause;
    throw new InternalError("Failed to reach Remarks API for watch annotations", cause);
  } finally {
    clearTimeout(timeoutHandle);
  }
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
