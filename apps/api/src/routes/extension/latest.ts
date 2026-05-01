import {
  type ExtensionRelease,
  NotFoundError,
  extensionReleaseManifestSchema,
} from "@remarks/shared";
import type { FastifyInstance } from "fastify";
import { env } from "../../env.js";
import { getObject, getPresignedGetUrl, headObject, withBucket } from "../../lib/r2.js";

const LATEST_MANIFEST_KEY = "releases/chrome/latest.json";

// Same TTL as screenshot GETs (ADR-0012). The URL is minted fresh on every
// page load, so a logged-in user always gets a usable link — the TTL only
// bounds how long one specific URL stays valid after its mint.
const PRESIGNED_TTL_SECONDS = 60 * 60;

export async function extensionRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/extension/latest", async (request, reply) => {
    const r2 = withBucket(request.server.r2, env.R2_BUCKET_EXTENSION_BUILDS);

    if (!(await headObject(r2, { key: LATEST_MANIFEST_KEY }))) {
      throw new NotFoundError("Extension release");
    }

    const manifestObj = await getObject(r2, { key: LATEST_MANIFEST_KEY });
    const manifestJson: unknown = JSON.parse(Buffer.from(manifestObj.body).toString("utf8"));
    const manifest = extensionReleaseManifestSchema.parse(manifestJson);

    const downloadUrl = await getPresignedGetUrl(r2, {
      key: manifest.key,
      ttlSeconds: PRESIGNED_TTL_SECONDS,
    });

    const response: ExtensionRelease = {
      version: manifest.version,
      downloadUrl,
      sha256: manifest.sha256,
      sizeBytes: manifest.sizeBytes,
      uploadedAt: manifest.uploadedAt,
    };
    return reply.code(200).send(response);
  });
}
