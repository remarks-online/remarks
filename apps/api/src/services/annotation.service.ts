import { type DB, schema } from "@remarks/db";
import {
  type AnnotationListResponse,
  type AnnotationResponse,
  type CreateAnnotationRequest,
  type ListAnnotationsQuery,
  ValidationError,
} from "@remarks/shared";
import { and, desc, eq, lt, or } from "drizzle-orm";
import {
  type AnnotationListCursor,
  decodeAnnotationListCursor,
  encodeAnnotationListCursor,
} from "../lib/cursor.js";
import { isUniqueViolation } from "../lib/db-errors.js";
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
    const key = buildAssetR2Key({
      projectId: input.projectId,
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

  const { annotationRow, assetRow } = await db.transaction(async (tx) => {
    const branchId = await findOrCreateBranch(tx, input.projectId, input.branch);

    const [insertedAnnotation] = await tx
      .insert(schema.annotations)
      .values({
        projectId: input.projectId,
        branchId,
        authorId: author.id,
        targetType: input.targetType,
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
      actorTokenId: null,
      type: "created",
      payload: {},
    });

    return { annotationRow: insertedAnnotation, assetRow: insertedAsset };
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

  return toAnnotationResponse({
    annotationRow,
    branchName: input.branch,
    author,
    assets: resolvedAssets,
  });
}

export interface ListAnnotationsArgs {
  projectId: string;
  query: ListAnnotationsQuery;
  r2: R2Client;
}

export async function listAnnotations(
  db: DB,
  args: ListAnnotationsArgs
): Promise<AnnotationListResponse> {
  const { projectId, query, r2 } = args;

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

  const where = and(
    eq(schema.annotations.projectId, projectId),
    query.status ? eq(schema.annotations.status, query.status) : undefined,
    branchFilterId ? eq(schema.annotations.branchId, branchFilterId) : undefined,
    cursorPredicate
  );

  const rows = await db.query.annotations.findMany({
    where,
    with: {
      branch: { columns: { name: true } },
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
            ttlSeconds: ANNOTATION_ASSET_GET_TTL_SECONDS,
          }),
        }))
      );
      return toAnnotationResponse({
        annotationRow: row,
        branchName: row.branch.name,
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

interface ResolvedAsset {
  row: AssetRow;
  url: string;
}

function toAnnotationResponse(args: {
  annotationRow: AnnotationRow;
  branchName: string;
  author: AnnotationResponse["author"];
  assets: ResolvedAsset[];
}): AnnotationResponse {
  const { annotationRow: row, branchName, author, assets } = args;
  return {
    id: row.id,
    projectId: row.projectId,
    branchId: row.branchId,
    branchName,
    status: row.status,
    targetType: row.targetType,
    url: row.url,
    targetSelector: row.targetSelector,
    targetCoords: row.targetCoords ?? null,
    viewport: row.viewport,
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
