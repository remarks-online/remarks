import { ValidationError } from "@remarks/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getMcpWhoami } from "../../services/mcp.service.js";

const paramsSchema = z.object({
  tokenId: z.string().uuid(),
});

// GET /internal/mcp/whoami/:tokenId — backs `remarks_whoami` (Phase 2 task
// 2.6). The MCP server's auth plugin already resolved the bearer token to a
// tokenId; this endpoint joins it to the project so the tool response can
// surface the human-readable token name and project metadata without the MCP
// server needing direct DB access (Phase 2 spec §8.5).
export async function whoamiRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/internal/mcp/whoami/:tokenId", async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw new ValidationError("Invalid path params", parsed.error.issues);
    }

    const payload = await getMcpWhoami(fastify.db, parsed.data.tokenId);
    return reply.code(200).send(payload);
  });
}
