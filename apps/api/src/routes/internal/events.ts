import { ValidationError } from "@remarks/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { assertProjectMember } from "../../lib/project-authorization.js";
import { loadUserProjectIds } from "../../services/event-stream.service.js";
import { resolveMcpUserId } from "../../services/mcp.service.js";
import { streamAnnotationEvents } from "../events/handler.js";

const projectParamsSchema = z.object({
  projectId: z.string().uuid(),
});

const projectQuerySchema = z.object({
  clerkUserId: z.string().min(1),
});

const userParamsSchema = z.object({
  clerkUserId: z.string().min(1),
});

// G9: internal/MCP twins of /projects/:projectId/events and
// /users/:userId/events. The internal-auth plugin already enforced the shared
// secret; these handlers still verify per-user project membership before
// opening the stream.
export async function eventsInternalRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/internal/mcp/projects/:projectId/events", async (request, reply) => {
    const paramsResult = projectParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      throw new ValidationError("Invalid path params", paramsResult.error.issues);
    }
    const queryResult = projectQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      throw new ValidationError("Invalid query params", queryResult.error.issues);
    }
    const { projectId } = paramsResult.data;
    const userId = await resolveMcpUserId(fastify.db, queryResult.data.clerkUserId);
    // Existence-leak posture matches the other internal annotation routes —
    // non-members surface as 404.
    await assertProjectMember(fastify.db, userId, projectId);

    await streamAnnotationEvents({
      fastify,
      request,
      reply,
      filter: { kind: "project", projectId },
    });
  });

  fastify.get("/internal/mcp/users/:clerkUserId/events", async (request, reply) => {
    const paramsResult = userParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      throw new ValidationError("Invalid path params", paramsResult.error.issues);
    }
    const userId = await resolveMcpUserId(fastify.db, paramsResult.data.clerkUserId);
    const projectIds = await loadUserProjectIds(fastify.db, userId);

    await streamAnnotationEvents({
      fastify,
      request,
      reply,
      filter: { kind: "user", userId, projectIds },
    });
  });
}
