import { type DB, schema } from "@remarks/db";
import { type AnnotationResponse, type AnnotationStatus, NotFoundError } from "@remarks/shared";
import { and, asc, desc, eq, isNotNull, ne, or, sql } from "drizzle-orm";
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
  token: { id: string; name: string; scopes: string[] };
  project: { id: string; name: string; slug: string };
}

export async function getMcpWhoami(db: DB, tokenId: string): Promise<WhoamiPayload> {
  const [row] = await db
    .select({
      tokenId: schema.projectApiTokens.id,
      tokenName: schema.projectApiTokens.name,
      tokenScopes: schema.projectApiTokens.scopes,
      tokenRevokedAt: schema.projectApiTokens.revokedAt,
      projectId: schema.projects.id,
      projectName: schema.projects.name,
      projectSlug: schema.projects.slug,
    })
    .from(schema.projectApiTokens)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectApiTokens.projectId))
    .where(eq(schema.projectApiTokens.id, tokenId))
    .limit(1);

  // Revoked tokens still resolve here so the MCP server can surface a useful
  // "your token was revoked" error to a client that has cached auth — the
  // upstream auth middleware would normally reject revoked tokens before the
  // request reaches whoami at all, so this branch is defensive.
  if (!row || row.tokenRevokedAt !== null) {
    throw new NotFoundError("Token");
  }

  return {
    token: { id: row.tokenId, name: row.tokenName, scopes: row.tokenScopes },
    project: { id: row.projectId, name: row.projectName, slug: row.projectSlug },
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

export async function getMcpAnnotationById(
  db: DB,
  args: { annotationId: string; projectId: string; r2: R2Client }
): Promise<McpAnnotationPayload> {
  const { annotationId, projectId, r2 } = args;

  // Single round-trip for the project-scope check: confirm the annotation
  // exists in the requested project, plus pre-load fields used both for
  // related-task matching and for the agent-only payload extension. Cross-
  // project access surfaces as 404 (existence not leaked), matching
  // requireProjectMember's behavior on the user-auth path.
  const row = await db.query.annotations.findFirst({
    where: eq(schema.annotations.id, annotationId),
    columns: {
      id: true,
      projectId: true,
      url: true,
      targetSelector: true,
      domContext: true,
      frameworkHint: true,
    },
  });
  if (!row || row.projectId !== projectId) {
    throw new NotFoundError("Annotation");
  }

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

  const relatedRows = await db
    .select({
      id: schema.annotations.id,
      status: schema.annotations.status,
      commentText: schema.annotations.commentText,
    })
    .from(schema.annotations)
    .where(
      and(
        eq(schema.annotations.projectId, projectId),
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
// annotation.service.ts but: (a) attribute via actor_token_id, not actor_id;
// (b) emit `agent_updated_status` / `agent_commented` event types so the
// dashboard can render them with an agent badge (Phase 2 spec §7.2). Cross-
// project access surfaces as 404 — same existence-leak posture as
// `getMcpAnnotationById`.

export interface AgentUpdateAnnotationStatusArgs {
  annotationId: string;
  projectId: string;
  tokenId: string;
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
  const { annotationId, projectId, tokenId, status, note } = args;

  type StatusTransition = { from: AnnotationStatus; to: AnnotationStatus } | null;

  const transition = await db.transaction<StatusTransition>(async (tx) => {
    const current = await tx.query.annotations.findFirst({
      where: eq(schema.annotations.id, annotationId),
      columns: { id: true, status: true, projectId: true },
    });
    // Project-scope check inside the tx so a concurrent project transfer
    // can't race past the existence guard. Cross-project is 404 (same as
    // getMcpAnnotationById) — existence not leaked.
    if (!current || current.projectId !== projectId) {
      throw new NotFoundError("Annotation");
    }

    // No-op short-circuit. Same-status retries (e.g., crash-loop after the
    // status was already flipped) shouldn't write a noisy
    // `agent_updated_status` event row. Idempotency keys cover exact
    // request replay; this guards different-key retries on already-applied
    // changes.
    if (current.status === status) return null;

    await tx
      .update(schema.annotations)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.annotations.id, annotationId));

    await tx.insert(schema.annotationEvents).values({
      annotationId,
      actorType: "agent",
      actorId: null,
      actorTokenId: tokenId,
      type: "agent_updated_status",
      payload: {
        from: current.status,
        to: status,
        ...(note !== undefined ? { note } : {}),
      },
    });

    return { from: current.status, to: status };
  });

  // Re-read for the response (need the post-update timestamp). Cheaper than
  // RETURNING because the transaction is already done by the time the agent
  // sees the response.
  const after = await db.query.annotations.findFirst({
    where: eq(schema.annotations.id, annotationId),
    columns: { id: true, status: true, updatedAt: true },
  });
  // After we've held the project-scope check inside the tx, the only way
  // `after` is null is concurrent deletion between tx commit and the read.
  // Treat that the same as a missing annotation.
  if (!after) throw new NotFoundError("Annotation");

  if (transition) {
    // Spec §7.5 — fire after commit. distinctId is the tokenId because the
    // agent path has no user. Property tag `actorType: "agent"` lets
    // analytics queries split human vs agent traffic in one funnel.
    captureAnalytics({
      event: "annotation_status_changed",
      distinctId: tokenId,
      properties: {
        annotationId,
        projectId,
        from: transition.from,
        to: transition.to,
        actorType: "agent",
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
  projectId: string;
  tokenId: string;
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
  const { annotationId, projectId, tokenId, comment, kind } = args;

  return db.transaction(async (tx) => {
    const current = await tx.query.annotations.findFirst({
      where: eq(schema.annotations.id, annotationId),
      columns: { id: true, projectId: true },
    });
    if (!current || current.projectId !== projectId) {
      throw new NotFoundError("Annotation");
    }

    const [row] = await tx
      .insert(schema.annotationEvents)
      .values({
        annotationId,
        actorType: "agent",
        actorId: null,
        actorTokenId: tokenId,
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
