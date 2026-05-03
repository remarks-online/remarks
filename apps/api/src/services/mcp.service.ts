import { type DB, schema } from "@remarks/db";
import { type AnnotationResponse, type AnnotationStatus, NotFoundError } from "@remarks/shared";
import { and, asc, desc, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { AppInngest } from "../inngest/client.js";
import {
  type AnnotationEventPublisher,
  buildAnnotationStreamEvent,
} from "../lib/annotation-event-bus.js";
import { capture as captureAnalytics } from "../lib/posthog.js";
import type { R2Client } from "../lib/r2.js";
import { getAnnotationById } from "./annotation.service.js";
import { fanOutAnnotationEvent } from "./webhook-fanout.service.js";

// Subset of statuses agents may set (Phase 2 spec §3.2 update_task_status,
// extended by G3 / ADR-0016 with `acknowledged`). Agents cannot reset to
// to_do; the schema in @remarks/mcp-schema enforces this at the wire layer,
// but the type here makes intent explicit.
type AgentSettableStatus = "doing" | "done" | "rejected" | "acknowledged";

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

// Distinct from project membership: this returns the orgs the user belongs to
// (Clerk-authoritative; we only see orgs whose membership has been synced into
// project_members on at least one project, so for now we go through projects).
//
// Used by `remarks_whoami` to surface `org_id`s the agent can pass back to
// `remarks_list_tasks` in org mode, and by the org-access check.
export interface UserOrgRow {
  id: string;
  clerkOrgId: string;
  name: string;
  slug: string;
  // Caller's role within the org. Sourced from project_members.role (per-project),
  // collapsed to "member" — full org-level role plumbing arrives with A15.
  role: string;
}

export async function listMcpUserOrgs(db: DB, clerkUserId: string): Promise<UserOrgRow[]> {
  const user = await db.query.users.findFirst({
    where: eq(schema.users.clerkUserId, clerkUserId),
    columns: { id: true },
  });
  if (!user) throw new NotFoundError("User");

  // Distinct over org because a user can be in many projects within one org.
  const rows = await db
    .selectDistinct({
      id: schema.organizations.id,
      clerkOrgId: schema.organizations.clerkOrgId,
      name: schema.organizations.name,
      slug: schema.organizations.slug,
    })
    .from(schema.organizations)
    .innerJoin(schema.projects, eq(schema.projects.orgId, schema.organizations.id))
    .innerJoin(schema.projectMembers, eq(schema.projectMembers.projectId, schema.projects.id))
    .where(eq(schema.projectMembers.userId, user.id));

  return rows.map((r) => ({ ...r, role: "member" }));
}

// 200/404 access check. Mirrors assertProjectAccess: returns true iff the user
// is a member of at least one project in the org identified by `orgId`
// (Remarks UUID — same id the agent passes to `remarks_list_tasks`).
export async function userHasOrgAccess(
  db: DB,
  clerkUserId: string,
  orgId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.projects.orgId })
    .from(schema.projectMembers)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectMembers.projectId))
    .innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId))
    .where(and(eq(schema.users.clerkUserId, clerkUserId), eq(schema.projects.orgId, orgId)))
    .limit(1);
  return row !== undefined;
}

// Resolves Clerk user id → internal users.id for the personal/org list endpoints
// that need to call listAnnotationsForUser. Throws NotFoundError("User") if the
// Clerk id has no corresponding user — same posture as getMcpWhoami.
export async function resolveMcpUserId(db: DB, clerkUserId: string): Promise<string> {
  const user = await db.query.users.findFirst({
    where: eq(schema.users.clerkUserId, clerkUserId),
    columns: { id: true },
  });
  if (!user) throw new NotFoundError("User");
  return user.id;
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
  // "Open" includes `acknowledged` (G3): an agent has noticed the task but
  // hasn't completed work, so it's still in-flight from a triage perspective.
  const openCount = sql<number>`COUNT(*) FILTER (WHERE ${schema.annotations.status} IN ('to_do','doing','acknowledged'))`;
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
    .having(
      sql`COUNT(*) FILTER (WHERE ${schema.annotations.status} IN ('to_do','doing','acknowledged')) > 0`
    )
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

// Phase 2 spec §3.2 get_task carries domContext + frameworkHint. domContext is
// already part of AnnotationResponse; frameworkHint is the only MCP-only
// extension here.
export interface McpAnnotationRow extends AnnotationResponse {
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
      groupId: true,
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
  // selector matches. G17: also union in members of the same multi-select
  // group so a captured batch shows up as a single related-tasks set even
  // when the siblings live on different URLs/selectors.
  const targetSelectorMatch =
    row.targetSelector !== null
      ? and(
          isNotNull(schema.annotations.targetSelector),
          eq(schema.annotations.targetSelector, row.targetSelector)
        )
      : undefined;
  const groupIdMatch =
    row.groupId !== null ? eq(schema.annotations.groupId, row.groupId) : undefined;

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
        or(eq(schema.annotations.url, row.url), targetSelectorMatch, groupIdMatch)
      )
    )
    .orderBy(asc(schema.annotations.createdAt), asc(schema.annotations.id))
    .limit(RELATED_TASKS_LIMIT);

  const annotationWithExtras: McpAnnotationRow = {
    ...annotation,
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
  // G4: required by upstream Zod refines when `status === "rejected"`. Lands
  // on the resulting event payload as `payload.reason`.
  reason?: string;
  publisher?: AnnotationEventPublisher;
  // G11: outbound webhook fan-out. Optional; tests omit.
  inngest?: AppInngest;
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
  const { annotationId, clerkUserId, oauthClientName, status, note, reason, publisher, inngest } =
    args;
  const actorId = await resolveUserIdByClerkId(db, clerkUserId);

  type StatusTransition = {
    from: AnnotationStatus;
    to: AnnotationStatus;
    projectId: string | null;
    authorId: string;
    eventId: string;
    eventCreatedAt: Date;
    eventType: "agent_acknowledged" | "agent_updated_status";
    payload: Record<string, unknown>;
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

    // G3: ack transitions get a dedicated event type so the dashboard can
    // render "agent acknowledged" as a compact pill rather than a full
    // status-change row. All other agent transitions stay as `agent_updated_status`.
    // G4: a `reason` is persisted on the payload when the agent rejected the
    // task — its presence is enforced upstream by Zod refines, so the
    // service just spreads it through.
    const eventType: "agent_acknowledged" | "agent_updated_status" =
      status === "acknowledged" ? "agent_acknowledged" : "agent_updated_status";
    const payload = {
      from: current.status,
      to: status,
      ...(note !== undefined ? { note } : {}),
      ...(reason !== undefined ? { reason } : {}),
    };
    const [eventRow] = await tx
      .insert(schema.annotationEvents)
      .values({
        annotationId,
        actorType: "agent",
        actorId,
        actorOauthClientId: oauthClientName,
        type: eventType,
        payload,
      })
      .returning({
        id: schema.annotationEvents.id,
        createdAt: schema.annotationEvents.createdAt,
      });
    if (!eventRow) throw new Error("annotation_events insert returned no rows");

    return {
      from: current.status,
      to: status,
      projectId: current.projectId,
      authorId: current.authorId,
      eventId: eventRow.id,
      eventCreatedAt: eventRow.createdAt,
      eventType,
      payload,
    };
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

    // G9: broadcast the agent transition.
    if (publisher) {
      void publisher.publish(
        buildAnnotationStreamEvent({
          eventId: transition.eventId,
          type: transition.eventType,
          payload: transition.payload,
          createdAt: transition.eventCreatedAt,
          actorType: "agent",
          actorId,
          actorOauthClientId: oauthClientName,
          annotationId,
          projectId: transition.projectId,
          authorId: transition.authorId,
        })
      );
    }

    // G11: fan out to project webhooks. The internal `agent_acknowledged`
    // event has no webhook mapping (intentional v1 omission); the fan-out
    // service no-ops on it.
    if (inngest) {
      void fanOutAnnotationEvent(db, inngest, {
        annotationEventType: transition.eventType,
        projectId: transition.projectId,
        annotationId,
        payload: transition.payload,
        occurredAt: transition.eventCreatedAt,
        newStatus: transition.to,
      });
    }
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
  publisher?: AnnotationEventPublisher;
  // G11: outbound webhook fan-out. Optional; tests omit.
  inngest?: AppInngest;
}

export interface AgentAddAnnotationCommentResult {
  eventId: string;
  createdAt: string;
}

export async function agentAddAnnotationComment(
  db: DB,
  args: AgentAddAnnotationCommentArgs
): Promise<AgentAddAnnotationCommentResult> {
  const { annotationId, clerkUserId, oauthClientName, comment, kind, publisher, inngest } = args;
  const actorId = await resolveUserIdByClerkId(db, clerkUserId);

  const result = await db.transaction(async (tx) => {
    const current = await tx.query.annotations.findFirst({
      where: eq(schema.annotations.id, annotationId),
      columns: { id: true, projectId: true, authorId: true },
    });
    if (!current) throw new NotFoundError("Annotation");
    const allowed = await userCanAccessAnnotation(tx as unknown as DB, clerkUserId, current);
    if (!allowed) throw new NotFoundError("Annotation");

    const payload = { comment, ...(kind !== undefined ? { kind } : {}) };
    const [row] = await tx
      .insert(schema.annotationEvents)
      .values({
        annotationId,
        actorType: "agent",
        actorId,
        actorOauthClientId: oauthClientName,
        type: "agent_commented",
        payload,
      })
      .returning({
        id: schema.annotationEvents.id,
        createdAt: schema.annotationEvents.createdAt,
      });
    if (!row) throw new Error("annotation_events insert returned no rows");

    return {
      eventId: row.id,
      createdAt: row.createdAt,
      projectId: current.projectId,
      authorId: current.authorId,
      payload,
    };
  });

  // G9: broadcast post-commit.
  if (publisher) {
    void publisher.publish(
      buildAnnotationStreamEvent({
        eventId: result.eventId,
        type: "agent_commented",
        payload: result.payload,
        createdAt: result.createdAt,
        actorType: "agent",
        actorId,
        actorOauthClientId: oauthClientName,
        annotationId,
        projectId: result.projectId,
        authorId: result.authorId,
      })
    );
  }

  // G11: fan out to project webhooks subscribed to comment events.
  if (inngest) {
    void fanOutAnnotationEvent(db, inngest, {
      annotationEventType: "agent_commented",
      projectId: result.projectId,
      annotationId,
      payload: result.payload,
      occurredAt: result.createdAt,
    });
  }

  return { eventId: result.eventId, createdAt: result.createdAt.toISOString() };
}
