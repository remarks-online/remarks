import { type DB, schema } from "@remarks/db";
import {
  type AnnotationEventResponse,
  type AnnotationListResponse,
  type AnnotationResponse,
  type AnnotationStatus,
  type CreateAnnotationRequest,
  type DomContextResponse,
  type DomContextValue,
  NotFoundError,
  type UpdateAnnotationRequest,
  ValidationError,
} from "@remarks/shared";
import { and, asc, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import type { AppInngest } from "../inngest/client.js";
import { publishR2Cleanup } from "../inngest/publish.js";
import {
  type AnnotationListCursor,
  decodeAnnotationListCursor,
  encodeAnnotationListCursor,
} from "../lib/cursor.js";
import { isUniqueViolation } from "../lib/db-errors.js";
import { capture as captureAnalytics } from "../lib/posthog.js";
import { type R2Client, getPresignedGetUrl, headObject } from "../lib/r2.js";
import { buildAssetR2Key } from "./upload.service.js";

export const ANNOTATION_ASSET_GET_TTL_SECONDS = 60 * 60 * 24;

export interface CreateAnnotationArgs {
  author: AnnotationResponse["author"];
  input: CreateAnnotationRequest;
  r2: R2Client;
}

type AnnotationRow = typeof schema.annotations.$inferSelect;
type AssetRow = typeof schema.annotationAssets.$inferSelect;

async function findOrCreateBranch(
  tx: Parameters<Parameters<DB["transaction"]>[0]>[0],
  projectId: string,
  name: string
): Promise<string> {
  const existing = await tx.query.branches.findFirst({
    where: and(eq(schema.branches.projectId, projectId), eq(schema.branches.name, name)),
    columns: { id: true },
  });
  if (existing) return existing.id;

  try {
    const [row] = await tx
      .insert(schema.branches)
      .values({ projectId, name })
      .returning({ id: schema.branches.id });
    if (!row) throw new Error("branch insert returned no rows");
    return row.id;
  } catch (err) {
    // Concurrent request won the unique-index race; re-read.
    if (!isUniqueViolation(err)) throw err;
    const raced = await tx.query.branches.findFirst({
      where: and(eq(schema.branches.projectId, projectId), eq(schema.branches.name, name)),
      columns: { id: true },
    });
    if (!raced) throw new Error("branch race resolved with missing row");
    return raced.id;
  }
}

export async function createAnnotation(
  db: DB,
  args: CreateAnnotationArgs
): Promise<AnnotationResponse> {
  const { author, input, r2 } = args;

  // The shared schema's refine guarantees these are paired; assert the invariant
  // here so the rest of the function can branch cleanly.
  const isProjectScoped = Boolean(input.projectId);
  if (isProjectScoped !== Boolean(input.branch)) {
    throw new ValidationError("projectId and branch must both be provided or both omitted");
  }

  // Resolve screenshot metadata BEFORE opening the transaction so we don't
  // hold a DB connection open during the R2 round-trip. If the asset is
  // missing, fail fast with 400 before any writes.
  let screenshotMeta: {
    assetId: string;
    key: string;
    contentType: string;
    sizeBytes: number;
  } | null = null;
  if (input.screenshotAssetId) {
    const key = input.projectId
      ? buildAssetR2Key({
          projectId: input.projectId,
          kind: "screenshot",
          assetId: input.screenshotAssetId,
        })
      : buildAssetR2Key({
          userId: author.id,
          kind: "screenshot",
          assetId: input.screenshotAssetId,
        });
    const head = await headObject(r2, { key });
    if (!head) {
      throw new ValidationError("Screenshot upload not found for given screenshotAssetId");
    }
    screenshotMeta = {
      assetId: input.screenshotAssetId,
      key,
      contentType: head.contentType ?? "application/octet-stream",
      sizeBytes: head.contentLength,
    };
  }

  const { annotationRow, assetRow, projectSlug } = await db.transaction(async (tx) => {
    const branchId =
      input.projectId && input.branch
        ? await findOrCreateBranch(tx, input.projectId, input.branch)
        : null;

    // Loaded inside the tx so the response carries the slug without a second
    // round-trip after commit. Personal (no projectId) keeps it null.
    const projectSlug = input.projectId
      ? ((
          await tx.query.projects.findFirst({
            where: eq(schema.projects.id, input.projectId),
            columns: { slug: true },
          })
        )?.slug ?? null)
      : null;

    const [insertedAnnotation] = await tx
      .insert(schema.annotations)
      .values({
        projectId: input.projectId ?? null,
        branchId,
        authorId: author.id,
        targetType: input.targetType,
        // G1/G2: optional triage classifiers. Both default to null when the
        // caller doesn't supply them.
        intent: input.intent ?? null,
        severity: input.severity ?? null,
        url: input.url,
        targetSelector: input.targetSelector ?? null,
        targetCoords: input.targetCoords ?? null,
        viewport: input.viewport,
        // Zod optional fields surface as `T | undefined`; the DB jsonb $type
        // declares them without the undefined. Runtime shape is equivalent.
        domContext: (input.domContext ?? null) as typeof schema.annotations.$inferInsert.domContext,
        frameworkHint: input.frameworkHint ?? null,
        commentText: input.commentText,
      })
      .returning();
    if (!insertedAnnotation) throw new Error("annotation insert returned no rows");

    let insertedAsset: AssetRow | null = null;
    if (screenshotMeta) {
      const [row] = await tx
        .insert(schema.annotationAssets)
        .values({
          id: screenshotMeta.assetId,
          annotationId: insertedAnnotation.id,
          kind: "screenshot",
          r2Key: screenshotMeta.key,
          contentType: screenshotMeta.contentType,
          sizeBytes: screenshotMeta.sizeBytes,
        })
        .returning();
      if (!row) throw new Error("annotation_assets insert returned no rows");
      insertedAsset = row;
    }

    // Spec §3.4: any state mutation on an annotation writes an event.
    await tx.insert(schema.annotationEvents).values({
      annotationId: insertedAnnotation.id,
      actorType: "user",
      actorId: author.id,
      actorOauthClientId: null,
      type: "created",
      payload: {},
    });

    return { annotationRow: insertedAnnotation, assetRow: insertedAsset, projectSlug };
  });

  const resolvedAssets: ResolvedAsset[] = assetRow
    ? [
        {
          row: assetRow,
          url: await getPresignedGetUrl(r2, {
            key: assetRow.r2Key,
            ttlSeconds: ANNOTATION_ASSET_GET_TTL_SECONDS,
          }),
        },
      ]
    : [];

  // Spec §7.5 — emitted after the transaction commits so we never report
  // events for rolled-back writes. Best-effort; PostHog outages don't fail
  // the request.
  captureAnalytics({
    event: "annotation_created",
    distinctId: author.id,
    properties: {
      annotationId: annotationRow.id,
      projectId: annotationRow.projectId,
      branchId: annotationRow.branchId,
      branchName: input.branch,
      targetType: annotationRow.targetType,
      hasScreenshot: assetRow !== null,
    },
  });

  return toAnnotationResponse({
    annotationRow,
    branchName: input.branch ?? null,
    projectSlug,
    author,
    assets: resolvedAssets,
  });
}

export interface ListAnnotationsServiceQuery {
  cursor?: string | undefined;
  limit: number;
  // Multi-status filter: empty array or undefined → no status filter. The
  // user-auth REST route still exposes a single-status query string and wraps
  // the value into a one-element array; the internal MCP route passes the
  // array directly so `remarks_list_tasks` can default to ["to_do","doing"]
  // (Phase 2 spec §3.2).
  statuses?: AnnotationStatus[] | undefined;
  branch?: string | undefined;
  url?: string | undefined;
}

export interface ListAnnotationsArgs {
  projectId: string;
  query: ListAnnotationsServiceQuery;
  r2: R2Client;
  // Override the default presign TTL. The dashboard uses the 24h default; the
  // MCP path passes 1h per Phase 2 spec §3.2 so screenshot URLs aren't
  // long-lived for agent traffic.
  assetTtlSeconds?: number;
}

export async function listAnnotations(
  db: DB,
  args: ListAnnotationsArgs
): Promise<AnnotationListResponse> {
  const { projectId, query, r2 } = args;
  const ttlSeconds = args.assetTtlSeconds ?? ANNOTATION_ASSET_GET_TTL_SECONDS;

  // Resolve `branch` (name) → branch id. A missing branch short-circuits to an
  // empty page instead of flowing through to the annotations query.
  let branchFilterId: string | null = null;
  if (query.branch) {
    const branchRow = await db.query.branches.findFirst({
      where: and(eq(schema.branches.projectId, projectId), eq(schema.branches.name, query.branch)),
      columns: { id: true },
    });
    if (!branchRow) return { items: [], nextCursor: null };
    branchFilterId = branchRow.id;
  }

  const cursor: AnnotationListCursor | null = query.cursor
    ? decodeAnnotationListCursor(query.cursor)
    : null;

  // Keyset predicate matches the (createdAt DESC, id DESC) order:
  //   (createdAt, id) < (cursor.createdAt, cursor.id)
  const cursorPredicate = cursor
    ? or(
        lt(schema.annotations.createdAt, new Date(cursor.createdAt)),
        and(
          eq(schema.annotations.createdAt, new Date(cursor.createdAt)),
          lt(schema.annotations.id, cursor.id)
        )
      )
    : undefined;

  const statusPredicate =
    query.statuses && query.statuses.length > 0
      ? inArray(schema.annotations.status, query.statuses)
      : undefined;

  const where = and(
    eq(schema.annotations.projectId, projectId),
    statusPredicate,
    branchFilterId ? eq(schema.annotations.branchId, branchFilterId) : undefined,
    query.url ? eq(schema.annotations.url, query.url) : undefined,
    cursorPredicate
  );

  const rows = await db.query.annotations.findMany({
    where,
    with: {
      branch: { columns: { name: true } },
      project: { columns: { slug: true } },
      author: { columns: { id: true, name: true, email: true, avatarUrl: true } },
      assets: true,
    },
    orderBy: [desc(schema.annotations.createdAt), desc(schema.annotations.id)],
    limit: query.limit + 1,
  });

  const hasMore = rows.length > query.limit;
  const pageRows = hasMore ? rows.slice(0, query.limit) : rows;

  const items = await Promise.all(
    pageRows.map(async (row) => {
      const resolvedAssets: ResolvedAsset[] = await Promise.all(
        row.assets.map(async (asset) => ({
          row: asset,
          url: await getPresignedGetUrl(r2, {
            key: asset.r2Key,
            ttlSeconds,
          }),
        }))
      );
      return toAnnotationResponse({
        annotationRow: row,
        branchName: row.branch?.name ?? null,
        projectSlug: row.project?.slug ?? null,
        author: row.author,
        assets: resolvedAssets,
      });
    })
  );

  const last = hasMore ? pageRows[pageRows.length - 1] : undefined;
  const nextCursor = last
    ? encodeAnnotationListCursor({
        createdAt: last.createdAt.toISOString(),
        id: last.id,
      })
    : null;

  return { items, nextCursor };
}

export interface ListAnnotationsForUserArgs {
  userId: string;
  query: {
    url?: string | undefined;
    statuses?: AnnotationStatus[] | undefined;
    cursor?: string | undefined;
    limit: number;
    // Scope selector:
    // - "personal" → only the caller's personal annotations (project_id IS NULL)
    // - "org"      → only annotations across the caller's projects within `orgId`
    // - "all" / undefined → personal + every project the caller is a member of
    scope?: "personal" | "org" | "all" | undefined;
    // Required when scope === "org"; the Remarks organization UUID
    // (organizations.id). Matches what the MCP `org_id` input carries.
    orgId?: string | undefined;
  };
  r2: R2Client;
  assetTtlSeconds?: number;
}

// List annotations the user can see across personal + project scopes. Used by
// the user-scoped REST endpoint, the dashboard's personal view, and the
// MCP-internal personal/org annotation endpoints.
export async function listAnnotationsForUser(
  db: DB,
  args: ListAnnotationsForUserArgs
): Promise<AnnotationListResponse> {
  const { userId, query, r2 } = args;
  const ttlSeconds = args.assetTtlSeconds ?? ANNOTATION_ASSET_GET_TTL_SECONDS;
  const scope = query.scope ?? "all";

  if (scope === "org" && !query.orgId) {
    throw new ValidationError("orgId is required when scope is 'org'");
  }

  // Resolve the set of projects the caller can see for this scope. Personal
  // scope skips the lookup entirely; org scope filters projects by org id so
  // the IN clause is already narrowed.
  const memberProjectIds =
    scope === "personal"
      ? []
      : scope === "org"
        ? (
            await db
              .select({ projectId: schema.projectMembers.projectId })
              .from(schema.projectMembers)
              .innerJoin(schema.projects, eq(schema.projects.id, schema.projectMembers.projectId))
              .where(
                and(
                  eq(schema.projectMembers.userId, userId),
                  // biome-ignore lint/style/noNonNullAssertion: validated above
                  eq(schema.projects.orgId, query.orgId!)
                )
              )
          ).map((row) => row.projectId)
        : (
            await db.query.projectMembers.findMany({
              where: eq(schema.projectMembers.userId, userId),
              columns: { projectId: true },
            })
          ).map((m) => m.projectId);

  const personalPredicate = and(
    eq(schema.annotations.authorId, userId),
    isNull(schema.annotations.projectId)
  );
  const projectPredicate =
    memberProjectIds.length > 0
      ? inArray(schema.annotations.projectId, memberProjectIds)
      : undefined;

  // Org scope is project-only — personal annotations don't belong to any org,
  // so they're explicitly excluded even though the caller could see them in
  // "all" mode. If the caller has no member projects in the org, short-circuit
  // to an empty page rather than building a query with no satisfiable predicate.
  if (scope === "org" && projectPredicate === undefined) {
    return { items: [], nextCursor: null };
  }
  const visibilityPredicate =
    scope === "personal"
      ? personalPredicate
      : scope === "org"
        ? projectPredicate
        : projectPredicate
          ? or(personalPredicate, projectPredicate)
          : personalPredicate;

  const cursor: AnnotationListCursor | null = query.cursor
    ? decodeAnnotationListCursor(query.cursor)
    : null;
  const cursorPredicate = cursor
    ? or(
        lt(schema.annotations.createdAt, new Date(cursor.createdAt)),
        and(
          eq(schema.annotations.createdAt, new Date(cursor.createdAt)),
          lt(schema.annotations.id, cursor.id)
        )
      )
    : undefined;

  const statusPredicate =
    query.statuses && query.statuses.length > 0
      ? inArray(schema.annotations.status, query.statuses)
      : undefined;

  const where = and(
    visibilityPredicate,
    query.url ? eq(schema.annotations.url, query.url) : undefined,
    statusPredicate,
    cursorPredicate
  );

  const rows = await db.query.annotations.findMany({
    where,
    with: {
      branch: { columns: { name: true } },
      project: { columns: { slug: true } },
      author: { columns: { id: true, name: true, email: true, avatarUrl: true } },
      assets: true,
    },
    orderBy: [desc(schema.annotations.createdAt), desc(schema.annotations.id)],
    limit: query.limit + 1,
  });

  const hasMore = rows.length > query.limit;
  const pageRows = hasMore ? rows.slice(0, query.limit) : rows;

  const items = await Promise.all(
    pageRows.map(async (row) => {
      const resolvedAssets: ResolvedAsset[] = await Promise.all(
        row.assets.map(async (asset) => ({
          row: asset,
          url: await getPresignedGetUrl(r2, {
            key: asset.r2Key,
            ttlSeconds,
          }),
        }))
      );
      return toAnnotationResponse({
        annotationRow: row,
        branchName: row.branch?.name ?? null,
        projectSlug: row.project?.slug ?? null,
        author: row.author,
        assets: resolvedAssets,
      });
    })
  );

  const last = hasMore ? pageRows[pageRows.length - 1] : undefined;
  const nextCursor = last
    ? encodeAnnotationListCursor({
        createdAt: last.createdAt.toISOString(),
        id: last.id,
      })
    : null;

  return { items, nextCursor };
}

export interface AnnotationOwnership {
  // Null for personal (URL-keyed) annotations.
  projectId: string | null;
  authorId: string;
}

export async function getAnnotationOwnership(
  db: DB,
  annotationId: string
): Promise<AnnotationOwnership> {
  const row = await db.query.annotations.findFirst({
    where: eq(schema.annotations.id, annotationId),
    columns: { projectId: true, authorId: true },
  });
  if (!row) throw new NotFoundError("Annotation");
  return row;
}

export interface GetAnnotationByIdOptions {
  // Override the default presign TTL. The dashboard uses the 24h default; the
  // MCP path passes 1h per Phase 2 spec §3.2 so screenshot URLs aren't
  // long-lived for agent traffic.
  assetTtlSeconds?: number;
}

export async function getAnnotationById(
  db: DB,
  annotationId: string,
  r2: R2Client,
  options: GetAnnotationByIdOptions = {}
): Promise<AnnotationResponse> {
  const ttlSeconds = options.assetTtlSeconds ?? ANNOTATION_ASSET_GET_TTL_SECONDS;
  const row = await db.query.annotations.findFirst({
    where: eq(schema.annotations.id, annotationId),
    with: {
      branch: { columns: { name: true } },
      project: { columns: { slug: true } },
      author: { columns: { id: true, name: true, email: true, avatarUrl: true } },
      assets: true,
    },
  });
  if (!row) throw new NotFoundError("Annotation");

  const resolvedAssets: ResolvedAsset[] = await Promise.all(
    row.assets.map(async (asset) => ({
      row: asset,
      url: await getPresignedGetUrl(r2, {
        key: asset.r2Key,
        ttlSeconds,
      }),
    }))
  );

  return toAnnotationResponse({
    annotationRow: row,
    branchName: row.branch?.name ?? null,
    projectSlug: row.project?.slug ?? null,
    author: row.author,
    assets: resolvedAssets,
  });
}

export interface UpdateAnnotationArgs {
  annotationId: string;
  actorId: string;
  input: UpdateAnnotationRequest;
  r2: R2Client;
}

export async function updateAnnotation(
  db: DB,
  args: UpdateAnnotationArgs
): Promise<AnnotationResponse> {
  const { annotationId, actorId, input, r2 } = args;

  type StatusTransition = { from: string; to: string; projectId: string | null };

  const statusTransition = await db.transaction<StatusTransition | null>(async (tx) => {
    const current = await tx.query.annotations.findFirst({
      where: eq(schema.annotations.id, annotationId),
      columns: { id: true, status: true, commentText: true, projectId: true },
    });
    if (!current) throw new NotFoundError("Annotation");

    const statusChanged = input.status !== undefined && input.status !== current.status;
    const commentChanged =
      input.commentText !== undefined && input.commentText !== current.commentText;

    // Body validation already requires at least one field; if neither produces
    // an actual change there's nothing to write and no event to emit.
    if (!statusChanged && !commentChanged) return null;

    await tx
      .update(schema.annotations)
      .set({
        ...(statusChanged ? { status: input.status } : {}),
        ...(commentChanged ? { commentText: input.commentText } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.annotations.id, annotationId));

    // Spec §3.4: any state mutation on an annotation writes an event.
    // G4: when the status flips to `rejected`, the request body's `reason`
    // (validated/trimmed by `updateAnnotationRequestSchema`) is persisted on
    // the event payload so reviewers can see why the task was dismissed.
    if (statusChanged) {
      await tx.insert(schema.annotationEvents).values({
        annotationId,
        actorType: "user",
        actorId,
        actorOauthClientId: null,
        type: "status_changed",
        payload: {
          from: current.status,
          to: input.status,
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
        },
      });
    }
    if (commentChanged) {
      await tx.insert(schema.annotationEvents).values({
        annotationId,
        actorType: "user",
        actorId,
        actorOauthClientId: null,
        type: "comment_edited",
        payload: { previousLength: current.commentText.length },
      });
    }

    if (!statusChanged) return null;
    return {
      from: current.status,
      to: input.status as string,
      projectId: current.projectId,
    };
  });

  // Spec §7.5 — fire after the commit so a rolled-back write doesn't surface
  // as an analytics event.
  if (statusTransition) {
    captureAnalytics({
      event: "annotation_status_changed",
      distinctId: actorId,
      properties: {
        annotationId,
        projectId: statusTransition.projectId,
        from: statusTransition.from,
        to: statusTransition.to,
        actorType: "user",
      },
    });
  }

  // Re-load the row outside the transaction so the response includes branch,
  // author, and assets without forcing the writer transaction to do extra work.
  return getAnnotationById(db, annotationId, r2);
}

export async function listAnnotationEvents(
  db: DB,
  annotationId: string
): Promise<AnnotationEventResponse[]> {
  // Confirm the annotation exists so callers can rely on 404 semantics
  // rather than an empty list masking a wrong id.
  const exists = await db.query.annotations.findFirst({
    where: eq(schema.annotations.id, annotationId),
    columns: { id: true },
  });
  if (!exists) throw new NotFoundError("Annotation");

  const rows = await db.query.annotationEvents.findMany({
    where: eq(schema.annotationEvents.annotationId, annotationId),
    with: {
      actor: { columns: { id: true, name: true, email: true, avatarUrl: true } },
    },
    orderBy: [asc(schema.annotationEvents.createdAt), asc(schema.annotationEvents.id)],
  });

  return rows.map((row) => ({
    id: row.id,
    annotationId: row.annotationId,
    type: row.type,
    actorType: row.actorType,
    // For "agent" and "system" events the join yields null. For "user" events
    // the actor row is expected but may be missing if the user was hard-deleted
    // — surface null there rather than crashing the response.
    actor: row.actor
      ? {
          id: row.actor.id,
          name: row.actor.name,
          email: row.actor.email,
          avatarUrl: row.actor.avatarUrl,
        }
      : null,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function deleteAnnotation(
  db: DB,
  inngest: AppInngest,
  annotationId: string
): Promise<void> {
  // Capture R2 keys *before* the delete — FK cascade on annotation_assets
  // erases them otherwise.
  const assetKeys = await db
    .select({ r2Key: schema.annotationAssets.r2Key })
    .from(schema.annotationAssets)
    .where(eq(schema.annotationAssets.annotationId, annotationId));

  // FK cascades on annotation_events and annotation_assets handle children.
  const deleted = await db
    .delete(schema.annotations)
    .where(eq(schema.annotations.id, annotationId))
    .returning({ id: schema.annotations.id });
  if (deleted.length === 0) throw new NotFoundError("Annotation");

  await publishR2Cleanup(
    inngest,
    assetKeys.map((k) => k.r2Key),
    `annotation:${annotationId}`
  );
}

interface ResolvedAsset {
  row: AssetRow;
  url: string;
}

function toDomContextResponse(
  value: DomContextValue | null | undefined
): DomContextResponse | null {
  if (!value) return null;
  return {
    tagName: value.tagName ?? null,
    classes: value.classes ?? null,
    textContent: value.textContent ?? null,
    computedStyles: value.computedStyles ?? null,
    ancestors:
      value.ancestors?.map((a) => ({ tagName: a.tagName, classes: a.classes ?? null })) ?? null,
  };
}

function toAnnotationResponse(args: {
  annotationRow: AnnotationRow;
  branchName: string | null;
  projectSlug: string | null;
  author: AnnotationResponse["author"];
  assets: ResolvedAsset[];
}): AnnotationResponse {
  const { annotationRow: row, branchName, projectSlug, author, assets } = args;
  return {
    id: row.id,
    projectId: row.projectId,
    projectSlug: row.projectId ? (projectSlug ?? null) : null,
    branchId: row.branchId,
    branchName: row.projectId ? (branchName ?? null) : null,
    status: row.status,
    targetType: row.targetType,
    intent: row.intent,
    severity: row.severity,
    url: row.url,
    targetSelector: row.targetSelector,
    targetCoords: row.targetCoords ?? null,
    viewport: row.viewport,
    domContext: toDomContextResponse(row.domContext),
    commentText: row.commentText,
    author,
    assets: assets.map((a) => ({
      id: a.row.id,
      kind: a.row.kind,
      url: a.url,
      contentType: a.row.contentType,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
