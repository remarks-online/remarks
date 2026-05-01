import { MAX_COMMENT_LENGTH, ValidationError } from "@remarks/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listAnnotationsForUser } from "../../services/annotation.service.js";
import {
  MCP_SCREENSHOT_GET_TTL_SECONDS,
  agentAddAnnotationComment,
  agentUpdateAnnotationStatus,
  getMcpAnnotationById,
  resolveMcpUserId,
  userHasOrgAccess,
} from "../../services/mcp.service.js";
import { mcpListQueryBaseSchema } from "./projects.js";

const paramsSchema = z.object({
  annotationId: z.string().uuid(),
});

const querySchema = z.object({
  clerkUserId: z.string().min(1),
});

const userParamsSchema = z.object({
  clerkUserId: z.string().min(1),
});

const userOrgParamsSchema = z.object({
  clerkUserId: z.string().min(1),
  orgId: z.string().uuid(),
});

// Phase 2 §3.2: agents may set doing/done/rejected; cannot reset to to_do.
// G3 (gap-analysis ADR-0016) adds `acknowledged` so an agent can signal "I've
// read this task" without yet picking it up — the dashboard renders these via
// the dedicated `agent_acknowledged` event type.
// Attribution moves to (clerkUserId, oauthClientName) per ADR-0015. The API
// resolves the annotation's project itself, then enforces project_members
// for the Clerk user; cross-project access surfaces as 404 (existence-leak
// posture preserved).
const statusUpdateBodySchema = z.object({
  clerkUserId: z.string().min(1),
  oauthClientName: z.string().min(1),
  status: z.enum(["doing", "done", "rejected", "acknowledged"]),
  note: z.string().optional(),
});

const commentBodySchema = z.object({
  clerkUserId: z.string().min(1),
  oauthClientName: z.string().min(1),
  comment: z.string().min(1).max(MAX_COMMENT_LENGTH),
  kind: z.enum(["clarification_request", "progress_update", "completion_note"]).optional(),
});

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
      clerkUserId: queryResult.data.clerkUserId,
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
      clerkUserId: bodyResult.data.clerkUserId,
      oauthClientName: bodyResult.data.oauthClientName,
      status: bodyResult.data.status,
      ...(bodyResult.data.note !== undefined ? { note: bodyResult.data.note } : {}),
    });
    return reply.code(200).send(result);
  });

  fastify.get("/internal/mcp/users/:clerkUserId/personal-annotations", async (request, reply) => {
    const paramsResult = userParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      throw new ValidationError("Invalid path params", paramsResult.error.issues);
    }
    const queryResult = mcpListQueryBaseSchema.safeParse(request.query);
    if (!queryResult.success) {
      throw new ValidationError("Invalid query params", queryResult.error.issues);
    }

    const userId = await resolveMcpUserId(fastify.db, paramsResult.data.clerkUserId);
    const result = await listAnnotationsForUser(fastify.db, {
      userId,
      query: {
        scope: "personal",
        statuses: queryResult.data.statuses,
        limit: queryResult.data.limit,
        cursor: queryResult.data.cursor,
      },
      r2: fastify.r2,
      assetTtlSeconds: MCP_SCREENSHOT_GET_TTL_SECONDS,
    });
    return reply.code(200).send(result);
  });

  fastify.get(
    "/internal/mcp/users/:clerkUserId/orgs/:orgId/annotations",
    async (request, reply) => {
      const paramsResult = userOrgParamsSchema.safeParse(request.params);
      if (!paramsResult.success) {
        throw new ValidationError("Invalid path params", paramsResult.error.issues);
      }
      const queryResult = mcpListQueryBaseSchema.safeParse(request.query);
      if (!queryResult.success) {
        throw new ValidationError("Invalid query params", queryResult.error.issues);
      }

      // Authorization: existence-leak posture. Non-member maps to 404 just like
      // the project endpoint via assertProjectAccess.
      const allowed = await userHasOrgAccess(
        fastify.db,
        paramsResult.data.clerkUserId,
        paramsResult.data.orgId
      );
      if (!allowed) return reply.code(404).send({ message: "Org not found" });

      const userId = await resolveMcpUserId(fastify.db, paramsResult.data.clerkUserId);
      const result = await listAnnotationsForUser(fastify.db, {
        userId,
        query: {
          scope: "org",
          orgId: paramsResult.data.orgId,
          statuses: queryResult.data.statuses,
          limit: queryResult.data.limit,
          cursor: queryResult.data.cursor,
        },
        r2: fastify.r2,
        assetTtlSeconds: MCP_SCREENSHOT_GET_TTL_SECONDS,
      });
      return reply.code(200).send(result);
    }
  );

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
      clerkUserId: bodyResult.data.clerkUserId,
      oauthClientName: bodyResult.data.oauthClientName,
      comment: bodyResult.data.comment,
      ...(bodyResult.data.kind !== undefined ? { kind: bodyResult.data.kind } : {}),
    });
    return reply.code(201).send(result);
  });
}
