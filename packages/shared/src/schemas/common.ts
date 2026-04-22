import { z } from "zod";
import { ASSET_KINDS, MAX_SCREENSHOT_BYTES } from "../constants.js";

export const presignedUploadRequestSchema = z.object({
  projectId: z.string().uuid(),
  kind: z.enum(ASSET_KINDS),
  contentType: z.string().regex(/^[a-z]+\/[a-zA-Z0-9.+-]+$/),
  sizeBytes: z.number().int().positive().max(MAX_SCREENSHOT_BYTES),
});

export type PresignedUploadRequest = z.infer<typeof presignedUploadRequestSchema>;

export const presignedUploadResponseSchema = z.object({
  assetId: z.string().uuid(),
  uploadUrl: z.string().url(),
  fields: z.record(z.string(), z.string()).optional(),
  expiresAt: z.string().datetime(),
});

export type PresignedUploadResponse = z.infer<typeof presignedUploadResponseSchema>;
