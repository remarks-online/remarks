import { ValidationError } from "@remarks/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getMcpWhoami } from "../../services/mcp.service.js";

const paramsSchema = z.object({
  clerkUserId: z.string().min(1),
});

// GET /internal/mcp/whoami/:clerkUserId — backs `remarks_whoami` (Phase 2 task
// 2.6, ADR-0015). The MCP server's auth plugin already verified the Clerk
// JWT and extracted the user id; this endpoint joins it to every project the
// user is a member of.
export async function whoamiRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/internal/mcp/whoami/:clerkUserId", async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw new ValidationError("Invalid path params", parsed.error.issues);
    }

    const payload = await getMcpWhoami(fastify.db, parsed.data.clerkUserId);
    return reply.code(200).send(payload);
  });
}
