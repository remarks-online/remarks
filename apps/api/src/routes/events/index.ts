import { NotFoundError, ValidationError } from "@remarks/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireProjectMember } from "../../lib/authorization.js";
import { loadUserProjectIds } from "../../services/event-stream.service.js";
import { streamAnnotationEvents } from "./handler.js";

const projectParamsSchema = z.object({
  projectId: z.string().uuid(),
});

const userParamsSchema = z.object({
  userId: z.string().uuid(),
});

// G9: Clerk-authenticated SSE event streams. Registered inside the
// `authenticated` scope in server.ts so request.auth is populated by the
// auth plugin before the handler runs.
export async function eventsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/projects/:projectId/events", async (request, reply) => {
    const paramsResult = projectParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      throw new ValidationError("Invalid path params", paramsResult.error.issues);
    }
    const { projectId } = paramsResult.data;
    await requireProjectMember(request, projectId);

    await streamAnnotationEvents({
      fastify,
      request,
      reply,
      filter: { kind: "project", projectId },
    });
  });

  fastify.get("/users/:userId/events", async (request, reply) => {
    const paramsResult = userParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      throw new ValidationError("Invalid path params", paramsResult.error.issues);
    }
    const { userId } = paramsResult.data;
    // Existence-leak posture: a caller can only subscribe to themselves.
    if (request.auth.user.id !== userId) {
      throw new NotFoundError("User");
    }
    const projectIds = await loadUserProjectIds(fastify.db, userId);

    await streamAnnotationEvents({
      fastify,
      request,
      reply,
      filter: { kind: "user", userId, projectIds },
    });
  });
}
