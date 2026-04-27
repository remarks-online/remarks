import { randomUUID } from "node:crypto";
import type { AssetKind, PresignedUploadRequest, PresignedUploadResponse } from "@remarks/shared";
import { type R2Client, getPresignedPutUrl } from "../lib/r2.js";

export const UPLOAD_PRESIGN_TTL_SECONDS = 300;

export function buildAssetR2Key(
  args: { kind: AssetKind; assetId: string } & ({ projectId: string } | { userId: string })
): string {
  if ("projectId" in args) {
    return `projects/${args.projectId}/${args.kind}/${args.assetId}`;
  }
  return `personal/${args.userId}/${args.kind}/${args.assetId}`;
}

export interface CreatePresignedUploadArgs {
  r2: R2Client;
  input: PresignedUploadRequest;
  // Required when input.projectId is absent: the authenticated user owning the
  // personal asset. Provided by the route, not the client.
  userId: string;
  now?: () => Date;
}

export async function createPresignedUpload(
  args: CreatePresignedUploadArgs
): Promise<PresignedUploadResponse> {
  const { r2, input, userId } = args;
  const assetId = randomUUID();
  const key = input.projectId
    ? buildAssetR2Key({ projectId: input.projectId, kind: input.kind, assetId })
    : buildAssetR2Key({ userId, kind: input.kind, assetId });
  const uploadUrl = await getPresignedPutUrl(r2, {
    key,
    contentType: input.contentType,
    ttlSeconds: UPLOAD_PRESIGN_TTL_SECONDS,
  });
  const nowMs = (args.now?.() ?? new Date()).getTime();
  const expiresAt = new Date(nowMs + UPLOAD_PRESIGN_TTL_SECONDS * 1000).toISOString();
  return { assetId, uploadUrl, expiresAt };
}
