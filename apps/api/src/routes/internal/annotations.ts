import { MAX_COMMENT_LENGTH, ValidationError } from "@remarks/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  agentAddAnnotationComment,
  agentUpdateAnnotationStatus,
  getMcpAnnotationById,
} from "../../services/mcp.service.js";

const paramsSchema = z.object({
  annotationId: z.string().uuid(),
});

const querySchema = z.object({
  projectId: z.string().uuid(),
});

// Phase 2 §3.2: agents may set doing/done/rejected; cannot reset to to_do.
const statusUpdateBodySchema = z.object({
  projectId: z.string().uuid(),
  tokenId: z.string().uuid(),
  status: z.enum(["doing", "done", "rejected"]),
  note: z.string().optional(),
});

const commentBodySchema = z.object({
  projectId: z.string().uuid(),
  tokenId: z.string().uuid(),
  comment: z.string().min(1).max(MAX_COMMENT_LENGTH),
  kind: z.enum(["clarification_request", "progress_update", "completion_note"]).optional(),
});

// GET /internal/mcp/annotations/:annotationId?projectId={uuid} — backs
// `remarks_get_task` (Phase 2 task 2.8). The MCP server passes its
// resolved auth.projectId so the API can return 404 (not 403) when an agent
// asks for an annotation outside the token's project. Keeps the
// existence-leak surface identical to requireProjectMember on the
// user-auth path.
//
// POST /internal/mcp/annotations/:annotationId/status — backs
// `remarks_update_task_status` (Phase 2 task 2.10). The MCP server forwards
// its resolved tokenId so the API can attribute the resulting
// `agent_updated_status` event correctly (actor_type='agent',
// actor_token_id=tokenId per the CHECK constraint in
// packages/db/src/schema/annotation-events.ts).
//
// POST /internal/mcp/annotations/:annotationId/comments — backs
// `remarks_add_task_comment` (Phase 2 task 2.11). Same trust model as the
// status route.
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

  fastify.post("/internal/mcp/annotations/:annotationId/status", async (request, reply) => {
    const paramsResult = paramsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      throw new ValidationError("Invalid path params", paramsResult.error.issues);
    }
    const bodyResult = statusUpdateBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      throw new ValidationError("Invalid request body", bodyResult.error.issues);
    }

    const result = await agentUpdateAnnotationStatus(fastify.db, {
      annotationId: paramsResult.data.annotationId,
      projectId: bodyResult.data.projectId,
      tokenId: bodyResult.data.tokenId,
      status: bodyResult.data.status,
      ...(bodyResult.data.note !== undefined ? { note: bodyResult.data.note } : {}),
    });
    return reply.code(200).send(result);
  });

  fastify.post("/internal/mcp/annotations/:annotationId/comments", async (request, reply) => {
    const paramsResult = paramsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      throw new ValidationError("Invalid path params", paramsResult.error.issues);
    }
    const bodyResult = commentBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      throw new ValidationError("Invalid request body", bodyResult.error.issues);
    }

    const result = await agentAddAnnotationComment(fastify.db, {
      annotationId: paramsResult.data.annotationId,
      projectId: bodyResult.data.projectId,
      tokenId: bodyResult.data.tokenId,
      comment: bodyResult.data.comment,
      ...(bodyResult.data.kind !== undefined ? { kind: bodyResult.data.kind } : {}),
    });
    return reply.code(201).send(result);
  });
}
