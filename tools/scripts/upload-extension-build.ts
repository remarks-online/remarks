/**
 * Upload an extension zip + manifest to R2.
 *
 * Invoked by .github/workflows/extension-release.yml after `pnpm zip` produces
 * apps/extension/.output/remarks-<version>-chrome.zip. Writes:
 *
 *   releases/chrome/remarks-chrome-<version>.zip   (immutable per version)
 *   releases/chrome/latest.json                    (overwritten each release)
 *
 * The dashboard's GET /v1/extension/latest reads latest.json, mints a
 * presigned GET URL for the keyed zip, and surfaces both to the
 * /app/download-extension page (ADR-0017).
 *
 * Required env:
 *   R2_ACCOUNT_ID            Cloudflare account hosting the bucket
 *   R2_ACCESS_KEY_ID         Bucket-scoped access key with read+write
 *   R2_SECRET_ACCESS_KEY     Bucket-scoped secret
 *   R2_BUCKET_EXTENSION_BUILDS  Target bucket name
 *   EXTENSION_VERSION        Semver MAJOR.MINOR.PATCH (passed by the workflow)
 *   EXTENSION_ZIP_PATH       Path to the chrome zip on disk
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";

const envSchema = z.object({
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_EXTENSION_BUILDS: z.string().min(1),
  EXTENSION_VERSION: z.string().regex(/^\d+\.\d+\.\d+$/, "must be semver MAJOR.MINOR.PATCH"),
  EXTENSION_ZIP_PATH: z.string().min(1),
  // Optional override used by local smoke tests pointing at MinIO.
  R2_S3_ENDPOINT: z.string().url().optional(),
});

async function main(): Promise<void> {
  const env = envSchema.parse(process.env);

  const zipStat = await stat(env.EXTENSION_ZIP_PATH);
  if (!zipStat.isFile() || zipStat.size === 0) {
    throw new Error(`zip is missing or empty at ${env.EXTENSION_ZIP_PATH}`);
  }
  const zipBytes = await readFile(env.EXTENSION_ZIP_PATH);
  const sha256 = createHash("sha256").update(zipBytes).digest("hex");

  const zipKey = `releases/chrome/remarks-chrome-${env.EXTENSION_VERSION}.zip`;
  const manifestKey = "releases/chrome/latest.json";
  const manifest = {
    version: env.EXTENSION_VERSION,
    sha256,
    sizeBytes: zipStat.size,
    uploadedAt: new Date().toISOString(),
    key: zipKey,
  };

  const endpoint = env.R2_S3_ENDPOINT ?? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const s3 = new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });

  // Upload the zip first; if the manifest write fails, the zip is still in
  // place but unreferenced — preferable to the inverse, where latest.json
  // points at a key that 404s.
  await s3.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET_EXTENSION_BUILDS,
      Key: zipKey,
      Body: zipBytes,
      ContentType: "application/zip",
    })
  );

  await s3.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET_EXTENSION_BUILDS,
      Key: manifestKey,
      Body: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
      ContentType: "application/json",
      CacheControl: "no-cache",
    })
  );

  s3.destroy();

  console.log(`Uploaded ${zipKey} (${zipStat.size} bytes, sha256=${sha256})`);
  console.log(`Updated ${manifestKey} → version ${env.EXTENSION_VERSION}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
