import { ValidationError, presignedUploadRequestSchema } from "@remarks/shared";
import type { FastifyInstance } from "fastify";
import { requireProjectMember } from "../../lib/authorization.js";
import { createPresignedUpload } from "../../services/upload.service.js";

export async function uploadRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post("/uploads/presign", async (request, reply) => {
    const bodyResult = presignedUploadRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      throw new ValidationError("Invalid request body", bodyResult.error.issues);
    }
    const input = bodyResult.data;

    // Editor+ only: the sole reason to presign an upload is to attach it to an
    // annotation, and annotation creation requires editor+. Gating here keeps
    // viewers from minting URLs they can never use.
    await requireProjectMember(request, input.projectId, { minRole: "editor" });

    const response = await createPresignedUpload({
      r2: request.server.r2,
      input,
    });
    return reply.code(201).send(response);
  });
}
