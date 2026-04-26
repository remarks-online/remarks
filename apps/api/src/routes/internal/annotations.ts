import { ValidationError } from "@remarks/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getMcpAnnotationById } from "../../services/mcp.service.js";

const paramsSchema = z.object({
  annotationId: z.string().uuid(),
});

const querySchema = z.object({
  projectId: z.string().uuid(),
});

// GET /internal/mcp/annotations/:annotationId?projectId={uuid} — backs
// `remarks_get_task` (Phase 2 task 2.8). The MCP server passes its
// resolved auth.projectId so the API can return 404 (not 403) when an agent
// asks for an annotation outside the token's project. Keeps the
// existence-leak surface identical to requireProjectMember on the
// user-auth path.
export async function annotationInternalRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/internal/mcp/annotations/:annotationId", async (request, reply) => {
    const paramsResult = paramsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      throw new ValidationError("Invalid path params", paramsResult.error.issues);
    }
    const queryResult = querySchema.safeParse(request.query);
    if (!queryResult.success) {
      throw new ValidationError("Invalid query params", queryResult.error.issues);
    }

    const payload = await getMcpAnnotationById(fastify.db, {
      annotationId: paramsResult.data.annotationId,
      projectId: queryResult.data.projectId,
      r2: fastify.r2,
    });
    return reply.code(200).send(payload);
  });
}
