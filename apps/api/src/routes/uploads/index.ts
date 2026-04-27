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
    // viewers from minting URLs they can never use. Personal uploads (no
    // projectId) only require the user to be signed in, since the resulting
    // asset will be keyed under the user's namespace and only attachable to
    // their own personal annotation.
    if (input.projectId) {
      await requireProjectMember(request, input.projectId, { minRole: "editor" });
    }

    const response = await createPresignedUpload({
      r2: request.server.r2,
      input,
      userId: request.auth.user.id,
    });
    return reply.code(201).send(response);
  });
}
