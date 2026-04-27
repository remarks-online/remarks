import { ValidationError } from "@remarks/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listMcpUserOrgs, userHasOrgAccess } from "../../services/mcp.service.js";

const listParamsSchema = z.object({
  clerkUserId: z.string().min(1),
});

const accessParamsSchema = z.object({
  clerkUserId: z.string().min(1),
  orgId: z.string().uuid(),
});

// /internal/users/:clerkUserId/orgs — list every org the Clerk user belongs to.
// Backs `remarks_whoami`'s `orgs` field so agents can drive `remarks_list_tasks`
// in org mode without first asking the dashboard.
//
// /internal/users/:clerkUserId/orgs/:clerkOrgId — boolean access check, 200 if
// member / 404 if not. Used as the per-tool-call authorization gate when the
// agent passes `org_id` to `remarks_list_tasks`. Existence-leak posture matches
// the project access gate.
export async function userOrgsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/internal/users/:clerkUserId/orgs", async (request, reply) => {
    const parsed = listParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw new ValidationError("Invalid path params", parsed.error.issues);
    }
    const orgs = await listMcpUserOrgs(fastify.db, parsed.data.clerkUserId);
    return reply.code(200).send({ orgs });
  });

  fastify.get("/internal/users/:clerkUserId/orgs/:orgId", async (request, reply) => {
    const parsed = accessParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw new ValidationError("Invalid path params", parsed.error.issues);
    }
    const allowed = await userHasOrgAccess(fastify.db, parsed.data.clerkUserId, parsed.data.orgId);
    if (!allowed) return reply.code(404).send({ error: { code: "NOT_FOUND" } });
    return reply.code(200).send({ ok: true });
  });
}
