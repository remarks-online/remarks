import { ValidationError, createProjectRequestSchema } from "@remarks/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireOrgMember } from "../../lib/authorization.js";
import { createProject } from "../../services/project.service.js";

const paramsSchema = z.object({
  orgId: z.string().min(1),
});

export async function projectRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post("/orgs/:orgId/projects", async (request, reply) => {
    const paramsResult = paramsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      throw new ValidationError("Invalid path params", paramsResult.error.issues);
    }
    const { orgId } = paramsResult.data;

    requireOrgMember(request, orgId, { role: "admin" });

    const bodyResult = createProjectRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      throw new ValidationError("Invalid request body", bodyResult.error.issues);
    }

    const response = await createProject(request.server.db, {
      clerkOrgId: orgId,
      authorUserId: request.auth.user.id,
      input: bodyResult.data,
    });

    return reply.code(201).send(response);
  });
}
