import { z } from "zod";

export const extensionReleaseSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "must be semver MAJOR.MINOR.PATCH"),
  downloadUrl: z.string().url(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, "must be a hex sha256 digest"),
  sizeBytes: z.number().int().positive(),
  uploadedAt: z.string().datetime(),
});

export type ExtensionRelease = z.infer<typeof extensionReleaseSchema>;

export const extensionReleaseManifestSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().positive(),
  uploadedAt: z.string().datetime(),
  key: z.string().min(1),
});

export type ExtensionReleaseManifest = z.infer<typeof extensionReleaseManifestSchema>;
