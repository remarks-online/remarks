import { type DB, schema } from "@remarks/db";
import { type AnnotationResponse, type AnnotationStatus, NotFoundError } from "@remarks/shared";
import { and, asc, desc, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { capture as captureAnalytics } from "../lib/posthog.js";
import type { R2Client } from "../lib/r2.js";
import { getAnnotationById } from "./annotation.service.js";

// Subset of statuses agents may set (Phase 2 spec §3.2 update_task_status).
// Agents cannot reset to to_do; the schema in @remarks/mcp-schema enforces
// this at the wire layer, but the type here makes intent explicit.
type AgentSettableStatus = "doing" | "done" | "rejected";

// Subset of mcpCommentKindSchema in @remarks/mcp-schema. Re-stated here so
// this service has no @remarks/mcp-schema dep (clean dependency direction:
// the API doesn't need to know about MCP wire shapes).
type AgentCommentKind = "clarification_request" | "progress_update" | "completion_note";

// Phase 2 spec §3.2: get_task screenshot_url is "presigned, 1h expiry".
export const MCP_SCREENSHOT_GET_TTL_SECONDS = 60 * 60;

// Cap on related-tasks fan-out. The agent uses these to spot dependencies
// before editing; ten covers the realistic same-page same-element cluster
// without bloating the response.
const RELATED_TASKS_LIMIT = 10;

export interface WhoamiPayload {
  user: { id: string; email: string | null; name: string | null };
  projects: Array<{ id: string; name: string; slug: string }>;
}

// Backs `remarks_whoami` under the OAuth model (ADR-0015). The MCP server's
// auth plugin already validated the bearer JWT and extracted the Clerk user
// ID; this endpoint joins the user to every project they have membership of.
export async function getMcpWhoami(db: DB, clerkUserId: string): Promise<WhoamiPayload> {
  const user = await db.query.users.findFirst({
    where: eq(schema.users.clerkUserId, clerkUserId),
    columns: { id: true, email: true, name: true },
  });
  if (!user) throw new NotFoundError("User");

  const projects = await db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      slug: schema.projects.slug,
    })
    .from(schema.projects)
    .innerJoin(schema.projectMembers, eq(schema.projectMembers.projectId, schema.projects.id))
    .where(eq(schema.projectMembers.userId, user.id));

  return {
    user: { id: user.id, email: user.email, name: user.name },
    projects,
  };
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

export async function getMcpProjectContext(
  db: DB,
  projectId: string
): Promise<ProjectContextPayload> {
  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
    columns: {
      id: true,
      name: true,
      slug: true,
      primaryBranch: true,
      gitRepoUrl: true,
    },
  });
  if (!project) throw new NotFoundError("Project");

  // One round-trip: per-branch open count + most-recent activity for any
  // branch that has at least one open annotation. Closed-only branches are
  // dropped via HAVING. last_activity intentionally spans all statuses so a
  // branch where everything just shipped still surfaces if it later gets a
  // new open task.
  const openCount = sql<number>`COUNT(*) FILTER (WHERE ${schema.annotations.status} IN ('to_do','doing'))`;
  // postgres-js parses timestamp *columns* into Date but doesn't infer the
  // type for raw aggregate expressions like MAX(...) — they come back as the
  // serialized string. Cast in SQL to ISO so the application layer doesn't
  // have to second-guess the driver's behavior across deployments.
  const lastActivity = sql<string>`to_char(MAX(${schema.annotations.updatedAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
  const rows = await db
    .select({
      name: schema.branches.name,
      openCount: openCount.mapWith(Number),
      lastActivity,
    })
    .from(schema.branches)
    .innerJoin(schema.annotations, eq(schema.annotations.branchId, schema.branches.id))
    .where(eq(schema.branches.projectId, projectId))
    .groupBy(schema.branches.id, schema.branches.name)
    .having(sql`COUNT(*) FILTER (WHERE ${schema.annotations.status} IN ('to_do','doing')) > 0`)
    .orderBy(desc(sql`MAX(${schema.annotations.updatedAt})`));

  return {
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      primaryBranch: project.primaryBranch,
      gitRepoUrl: project.gitRepoUrl,
    },
    activeBranches: rows.map((r) => ({
      name: r.name,
      openTaskCount: r.openCount,
      lastActivity: r.lastActivity,
    })),
  };
}

export interface RelatedTaskRow {
  id: string;
  status: AnnotationStatus;
  commentText: string;
}

// Subset of `annotations.dom_context` jsonb that the MCP `get_task` schema
// surfaces back to the agent. Keeps the camelCase keys here; the MCP server
// projects to snake_case at the wire boundary.
export interface McpDomContextRow {
  tagName?: string;
  classes?: string[];
  textContent?: string;
  computedStyles?: Record<string, string>;
  ancestors?: Array<{ tagName: string; classes?: string[] }>;
}

// Phase 2 spec §3.2 get_task carries domContext + frameworkHint; the public
// AnnotationResponse used by the dashboard does not (those fields are
// agent-only signals). So the MCP endpoint returns an extended shape rather
// than reusing AnnotationResponse verbatim.
export interface McpAnnotationRow extends AnnotationResponse {
  domContext: McpDomContextRow | null;
  frameworkHint: string | null;
}

export interface McpAnnotationPayload {
  annotation: McpAnnotationRow;
  relatedTasks: RelatedTaskRow[];
}

// Agent access gate. Mirrors authorizeAnnotationAccess in lib/authorization.ts
// but operates on a Clerk user id rather than a Fastify request, since the MCP
// internal endpoints have already exchanged the OAuth token for a Clerk id.
//
// - Project-scoped (projectId set): must be a member of that project.
// - Personal (projectId null): caller must be the author. The author lookup is
//   keyed on the local users.id, so we resolve clerkUserId → users.id once.
async function userCanAccessAnnotation(
  db: DB,
  clerkUserId: string,
  ownership: { projectId: string | null; authorId: string }
): Promise<boolean> {
  if (ownership.projectId === null) {
    const user = await db.query.users.findFirst({
      where: eq(schema.users.clerkUserId, clerkUserId),
      columns: { id: true },
    });
    return user !== undefined && user.id === ownership.authorId;
  }
  const [row] = await db
    .select({ projectId: schema.projectMembers.projectId })
    .from(schema.projectMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId))
    .where(
      and(
        eq(schema.users.clerkUserId, clerkUserId),
        eq(schema.projectMembers.projectId, ownership.projectId)
      )
    )
    .limit(1);
  return row !== undefined;
}

export async function getMcpAnnotationById(
  db: DB,
  args: { annotationId: string; clerkUserId: string; r2: R2Client }
): Promise<McpAnnotationPayload> {
  const { annotationId, clerkUserId, r2 } = args;

  // Look up the annotation to discover its project, then check membership.
  // Existence-leak posture: any failure (annotation missing, user not a
  // member of its project) maps to NotFoundError("Annotation"), so an agent
  // can't use this endpoint to enumerate annotation IDs.
  const row = await db.query.annotations.findFirst({
    where: eq(schema.annotations.id, annotationId),
    columns: {
      id: true,
      projectId: true,
      authorId: true,
      url: true,
      targetSelector: true,
      domContext: true,
      frameworkHint: true,
    },
  });
  if (!row) throw new NotFoundError("Annotation");
  const allowed = await userCanAccessAnnotation(db, clerkUserId, row);
  if (!allowed) throw new NotFoundError("Annotation");

  const annotation = await getAnnotationById(db, annotationId, r2, {
    assetTtlSeconds: MCP_SCREENSHOT_GET_TTL_SECONDS,
  });

  // "Other tasks on the same URL or targeting the same element" (§3.2).
  // OR-of-equalities so a rectangle annotation (no selector) still pulls
  // co-located URL siblings, and an element annotation pulls both URL +
  // selector matches.
  const targetSelectorMatch =
    row.targetSelector !== null
      ? and(
          isNotNull(schema.annotations.targetSelector),
          eq(schema.annotations.targetSelector, row.targetSelector)
        )
      : undefined;

  // Scope siblings to the same visibility bucket as the source annotation:
  // project peers if the source is project-scoped, the author's other personal
  // annotations otherwise. Privacy rule: personal annotations never leak into
  // someone else's related-tasks set.
  const scopePredicate =
    row.projectId !== null
      ? eq(schema.annotations.projectId, row.projectId)
      : and(isNull(schema.annotations.projectId), eq(schema.annotations.authorId, row.authorId));

  const relatedRows = await db
    .select({
      id: schema.annotations.id,
      status: schema.annotations.status,
      commentText: schema.annotations.commentText,
    })
    .from(schema.annotations)
    .where(
      and(
        scopePredicate,
        ne(schema.annotations.id, annotationId),
        or(eq(schema.annotations.url, row.url), targetSelectorMatch)
      )
    )
    .orderBy(asc(schema.annotations.createdAt), asc(schema.annotations.id))
    .limit(RELATED_TASKS_LIMIT);

  const annotationWithExtras: McpAnnotationRow = {
    ...annotation,
    domContext: row.domContext as McpDomContextRow | null,
    frameworkHint: row.frameworkHint,
  };

  return { annotation: annotationWithExtras, relatedTasks: relatedRows };
}

// --- Agent mutation paths (Phase 2 tasks 2.10–2.11) ---
//
// Mirror the user-auth `updateAnnotation` / event-creation paths in
// annotation.service.ts. Per ADR-0015 attribution is via:
//   actor_id              → users row matched by Clerk user id (the human who
//                            authorized the OAuth grant the agent is using)
//   actor_oauth_client_id → human-readable name of the OAuth app from DCR
//                            (e.g. "Claude Code")
// Emits `agent_updated_status` / `agent_commented` event types so the
// dashboard can render them with an agent badge (Phase 2 spec §7.2).
// Cross-project access surfaces as 404 — existence-leak posture matches
// getMcpAnnotationById.

async function resolveUserIdByClerkId(db: DB, clerkUserId: string): Promise<string> {
  const user = await db.query.users.findFirst({
    where: eq(schema.users.clerkUserId, clerkUserId),
    columns: { id: true },
  });
  if (!user) throw new NotFoundError("User");
  return user.id;
}

export interface AgentUpdateAnnotationStatusArgs {
  annotationId: string;
  clerkUserId: string;
  oauthClientName: string;
  status: AgentSettableStatus;
  note?: string;
}

export interface AgentUpdateAnnotationStatusResult {
  id: string;
  status: AnnotationStatus;
  updatedAt: string;
}

export async function agentUpdateAnnotationStatus(
  db: DB,
  args: AgentUpdateAnnotationStatusArgs
): Promise<AgentUpdateAnnotationStatusResult> {
  const { annotationId, clerkUserId, oauthClientName, status, note } = args;
  const actorId = await resolveUserIdByClerkId(db, clerkUserId);

  type StatusTransition = {
    from: AnnotationStatus;
    to: AnnotationStatus;
    projectId: string | null;
  } | null;

  const transition = await db.transaction<StatusTransition>(async (tx) => {
    const current = await tx.query.annotations.findFirst({
      where: eq(schema.annotations.id, annotationId),
      columns: { id: true, status: true, projectId: true, authorId: true },
    });
    if (!current) throw new NotFoundError("Annotation");
    const allowed = await userCanAccessAnnotation(tx as unknown as DB, clerkUserId, current);
    if (!allowed) throw new NotFoundError("Annotation");

    if (current.status === status) return null;

    await tx
      .update(schema.annotations)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.annotations.id, annotationId));

    await tx.insert(schema.annotationEvents).values({
      annotationId,
      actorType: "agent",
      actorId,
      actorOauthClientId: oauthClientName,
      type: "agent_updated_status",
      payload: {
        from: current.status,
        to: status,
        ...(note !== undefined ? { note } : {}),
      },
    });

    return { from: current.status, to: status, projectId: current.projectId };
  });

  const after = await db.query.annotations.findFirst({
    where: eq(schema.annotations.id, annotationId),
    columns: { id: true, status: true, updatedAt: true },
  });
  if (!after) throw new NotFoundError("Annotation");

  if (transition) {
    captureAnalytics({
      event: "annotation_status_changed",
      distinctId: clerkUserId,
      properties: {
        annotationId,
        projectId: transition.projectId,
        from: transition.from,
        to: transition.to,
        actorType: "agent",
        oauthClientName,
      },
    });
  }

  return {
    id: after.id,
    status: after.status,
    updatedAt: after.updatedAt.toISOString(),
  };
}

export interface AgentAddAnnotationCommentArgs {
  annotationId: string;
  clerkUserId: string;
  oauthClientName: string;
  comment: string;
  kind?: AgentCommentKind;
}

export interface AgentAddAnnotationCommentResult {
  eventId: string;
  createdAt: string;
}

export async function agentAddAnnotationComment(
  db: DB,
  args: AgentAddAnnotationCommentArgs
): Promise<AgentAddAnnotationCommentResult> {
  const { annotationId, clerkUserId, oauthClientName, comment, kind } = args;
  const actorId = await resolveUserIdByClerkId(db, clerkUserId);

  return db.transaction(async (tx) => {
    const current = await tx.query.annotations.findFirst({
      where: eq(schema.annotations.id, annotationId),
      columns: { id: true, projectId: true, authorId: true },
    });
    if (!current) throw new NotFoundError("Annotation");
    const allowed = await userCanAccessAnnotation(tx as unknown as DB, clerkUserId, current);
    if (!allowed) throw new NotFoundError("Annotation");

    const [row] = await tx
      .insert(schema.annotationEvents)
      .values({
        annotationId,
        actorType: "agent",
        actorId,
        actorOauthClientId: oauthClientName,
        type: "agent_commented",
        payload: { comment, ...(kind !== undefined ? { kind } : {}) },
      })
      .returning({
        id: schema.annotationEvents.id,
        createdAt: schema.annotationEvents.createdAt,
      });
    if (!row) throw new Error("annotation_events insert returned no rows");

    return { eventId: row.id, createdAt: row.createdAt.toISOString() };
  });
}
