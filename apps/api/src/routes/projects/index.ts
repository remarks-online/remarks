import { ValidationError, createProjectRequestSchema } from "@remarks/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireOrgMember, requireProjectMember } from "../../lib/authorization.js";
import {
  createProject,
  getProjectById,
  listProjectsByOrg,
} from "../../services/project.service.js";

const orgParamsSchema = z.object({
  orgId: z.string().min(1),
});

const projectParamsSchema = z.object({
  projectId: z.string().uuid(),
});

export async function projectRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post("/orgs/:orgId/projects", async (request, reply) => {
    const paramsResult = orgParamsSchema.safeParse(request.params);
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

  fastify.get("/orgs/:orgId/projects", async (request, reply) => {
    const paramsResult = orgParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      throw new ValidationError("Invalid path params", paramsResult.error.issues);
    }
    const { orgId } = paramsResult.data;

    requireOrgMember(request, orgId);

    const items = await listProjectsByOrg(request.server.db, orgId);
    return reply.code(200).send({ items });
  });

  fastify.get("/projects/:projectId", async (request, reply) => {
    const paramsResult = projectParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      throw new ValidationError("Invalid path params", paramsResult.error.issues);
    }
    const { projectId } = paramsResult.data;

    // requireProjectMember returns 404 for non-members, so project existence
    // isn't leaked to callers who aren't on the member list.
    await requireProjectMember(request, projectId);

    const project = await getProjectById(request.server.db, projectId);
    return reply.code(200).send(project);
  });
}
