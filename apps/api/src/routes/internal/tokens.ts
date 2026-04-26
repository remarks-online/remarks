import { schema } from "@remarks/db";
import { NotFoundError, ValidationError } from "@remarks/shared";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const resolveBodySchema = z.object({
  tokenHash: z.string().min(1),
});

// POST /internal/mcp/tokens/resolve — Phase 2 spec §5.4 task 2.5.
// Single source of truth for "is this hashed bearer still good?". Returns the
// resolved auth context that the MCP server caches for 5 min.
//
// Single atomic UPDATE … RETURNING (rather than SELECT-then-UPDATE) means
// `last_used_at` only bumps when the token is actually valid, the
// active-token check happens in one round trip, and there's no race window
// where a revoke could land between the SELECT and the UPDATE.
export async function tokenRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post("/internal/mcp/tokens/resolve", async (request, reply) => {
    const parsed = resolveBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid request body", parsed.error.issues);
    }

    const [row] = await fastify.db
      .update(schema.projectApiTokens)
      .set({ lastUsedAt: sql`NOW()` })
      .where(
        and(
          eq(schema.projectApiTokens.tokenHash, parsed.data.tokenHash),
          isNull(schema.projectApiTokens.revokedAt),
          or(
            isNull(schema.projectApiTokens.expiresAt),
            gt(schema.projectApiTokens.expiresAt, sql`NOW()`)
          )
        )
      )
      .returning({
        tokenId: schema.projectApiTokens.id,
        projectId: schema.projectApiTokens.projectId,
        scopes: schema.projectApiTokens.scopes,
      });

    if (!row) throw new NotFoundError("Token");
    return reply.code(200).send(row);
  });
}
