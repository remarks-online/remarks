import { type DB, schema } from "@remarks/db";
import {
  type AnnotationResponse,
  type CreateAnnotationRequest,
  ValidationError,
} from "@remarks/shared";
import { and, eq } from "drizzle-orm";
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

  return toAnnotationResponse({
    annotationRow,
    branchName: input.branch,
    author,
    assetRow,
    assetUrl: assetRow
      ? await getPresignedGetUrl(r2, {
          key: assetRow.r2Key,
          ttlSeconds: ANNOTATION_ASSET_GET_TTL_SECONDS,
        })
      : null,
  });
}

function toAnnotationResponse(args: {
  annotationRow: AnnotationRow;
  branchName: string;
  author: AnnotationResponse["author"];
  assetRow: AssetRow | null;
  assetUrl: string | null;
}): AnnotationResponse {
  const { annotationRow: row, branchName, author, assetRow, assetUrl } = args;
  const assets: AnnotationResponse["assets"] =
    assetRow && assetUrl
      ? [
          {
            id: assetRow.id,
            kind: assetRow.kind,
            url: assetUrl,
            contentType: assetRow.contentType,
          },
        ]
      : [];

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
    assets,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
