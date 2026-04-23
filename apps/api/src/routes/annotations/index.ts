import {
  ValidationError,
  createAnnotationRequestSchema,
  listAnnotationsQuerySchema,
} from "@remarks/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireProjectMember } from "../../lib/authorization.js";
import { createAnnotation, listAnnotations } from "../../services/annotation.service.js";

const projectParamsSchema = z.object({
  projectId: z.string().uuid(),
});

export async function annotationRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/projects/:projectId/annotations", async (request, reply) => {
    const paramsResult = projectParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      throw new ValidationError("Invalid path params", paramsResult.error.issues);
    }
    const { projectId } = paramsResult.data;

    await requireProjectMember(request, projectId);

    const queryResult = listAnnotationsQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      throw new ValidationError("Invalid query params", queryResult.error.issues);
    }

    const result = await listAnnotations(request.server.db, {
      projectId,
      query: queryResult.data,
      r2: request.server.r2,
    });
    return reply.send(result);
  });

  fastify.post("/projects/:projectId/annotations", async (request, reply) => {
    const paramsResult = projectParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      throw new ValidationError("Invalid path params", paramsResult.error.issues);
    }
    const { projectId } = paramsResult.data;

    await requireProjectMember(request, projectId, { minRole: "editor" });

    // Spec example omits projectId from body (path-authoritative). Inject it
    // before validation so the shared schema continues to require a UUID here.
    const bodyWithPath = {
      ...(typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {}),
      projectId,
    };
    const bodyResult = createAnnotationRequestSchema.safeParse(bodyWithPath);
    if (!bodyResult.success) {
      throw new ValidationError("Invalid request body", bodyResult.error.issues);
    }

    // The auth middleware only allows non-soft-deleted users to reach this
    // route, so email is guaranteed non-null here. Guarding anyway because
    // the DB column is nullable and the response schema isn't.
    const authorEmail = request.auth.user.email;
    if (!authorEmail) {
      throw new ValidationError("Authenticated user has no email address");
    }

    const response = await createAnnotation(request.server.db, {
      author: {
        id: request.auth.user.id,
        email: authorEmail,
        name: request.auth.user.name,
        avatarUrl: request.auth.user.avatarUrl,
      },
      input: bodyResult.data,
      r2: request.server.r2,
    });

    return reply.code(201).send(response);
  });
}
