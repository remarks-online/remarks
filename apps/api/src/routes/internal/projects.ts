import { ANNOTATION_STATUSES, ValidationError } from "@remarks/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listAnnotations } from "../../services/annotation.service.js";
import {
  MCP_SCREENSHOT_GET_TTL_SECONDS,
  getMcpProjectContext,
} from "../../services/mcp.service.js";

const paramsSchema = z.object({
  projectId: z.string().uuid(),
});

// Shared query parser for the project / personal / org list endpoints. The
// project route uses the full shape; personal/org routes pick the subset they
// support (no `branch`, since branches are project-scoped).
export const mcpListQueryStatusesSchema = z
  .string()
  .optional()
  .transform((value) => {
    if (value === undefined || value === "") return undefined;
    const parts = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return parts;
  })
  .pipe(z.array(z.enum(ANNOTATION_STATUSES)).optional());

export const mcpListQueryBaseSchema = z.object({
  // CSV of statuses (e.g., `to_do,doing`). Empty string parses as no filter.
  // The MCP server defaults to ["to_do","doing"] when the agent omits it; the
  // server-side default lives there, not here, so this query is purely
  // pass-through.
  statuses: mcpListQueryStatusesSchema,
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

const annotationsListQuerySchema = mcpListQueryBaseSchema.extend({
  branch: z.string().min(1).optional(),
});

// Internal MCP-only project routes (Phase 2 tasks 2.7 + 2.9).
//
// /context backs `remarks_get_project_context`: project metadata + active
// branches with open task counts.
//
// /annotations backs `remarks_list_tasks`: same cursor pagination as the
// user-auth list endpoint, but accepts a multi-status array (the user-auth
// schema is single-status). Asset URLs presigned at the 1h MCP TTL because
// `has_screenshot` is the only screenshot-related field exposed to agents
// in the list shape — the screenshot URL itself only ships in get_task —
// but we keep TTLs aligned across the MCP path so internal callers don't
// hold stale dashboard-grade URLs.
export async function projectInternalRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/internal/mcp/projects/:projectId/context", async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw new ValidationError("Invalid path params", parsed.error.issues);
    }

    const payload = await getMcpProjectContext(fastify.db, parsed.data.projectId);
    return reply.code(200).send(payload);
  });

  fastify.get("/internal/mcp/projects/:projectId/annotations", async (request, reply) => {
    const paramsResult = paramsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      throw new ValidationError("Invalid path params", paramsResult.error.issues);
    }
    const queryResult = annotationsListQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      throw new ValidationError("Invalid query params", queryResult.error.issues);
    }

    const result = await listAnnotations(fastify.db, {
      projectId: paramsResult.data.projectId,
      query: {
        statuses: queryResult.data.statuses,
        branch: queryResult.data.branch,
        limit: queryResult.data.limit,
        cursor: queryResult.data.cursor,
      },
      r2: fastify.r2,
      assetTtlSeconds: MCP_SCREENSHOT_GET_TTL_SECONDS,
    });
    return reply.code(200).send(result);
  });
}
