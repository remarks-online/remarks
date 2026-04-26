import { type DB, schema } from "@remarks/db";
import { ValidationError } from "@remarks/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const listParamsSchema = z.object({
  clerkUserId: z.string().min(1),
});

const accessParamsSchema = z.object({
  clerkUserId: z.string().min(1),
  projectId: z.string().uuid(),
});

interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
}

async function listProjectsForClerkUser(db: DB, clerkUserId: string): Promise<ProjectSummary[]> {
  const rows = await db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      slug: schema.projects.slug,
    })
    .from(schema.projects)
    .innerJoin(schema.projectMembers, eq(schema.projectMembers.projectId, schema.projects.id))
    .innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId))
    .where(eq(schema.users.clerkUserId, clerkUserId));
  return rows;
}

async function userHasProjectAccess(
  db: DB,
  clerkUserId: string,
  projectId: string
): Promise<boolean> {
  const [row] = await db
    .select({ projectId: schema.projectMembers.projectId })
    .from(schema.projectMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId))
    .where(
      and(eq(schema.users.clerkUserId, clerkUserId), eq(schema.projectMembers.projectId, projectId))
    )
    .limit(1);
  return row !== undefined;
}

// /internal/users/:clerkUserId/projects — list every project the Clerk user
// is a member of. Backs `remarks_whoami` and warms the per-user membership
// cache in the MCP server (ADR-0015 §5.4).
//
// /internal/users/:clerkUserId/projects/:projectId — boolean access check,
// 200 if member / 404 if not. Used as the per-tool-call authorization gate.
// Existence-leak posture matches the user-auth path: cross-project access
// surfaces as 404, never 403, so we don't reveal whether the project exists.
export async function userProjectsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/internal/users/:clerkUserId/projects", async (request, reply) => {
    const parsed = listParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw new ValidationError("Invalid path params", parsed.error.issues);
    }
    const projects = await listProjectsForClerkUser(fastify.db, parsed.data.clerkUserId);
    return reply.code(200).send({ projects });
  });

  fastify.get("/internal/users/:clerkUserId/projects/:projectId", async (request, reply) => {
    const parsed = accessParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw new ValidationError("Invalid path params", parsed.error.issues);
    }
    const allowed = await userHasProjectAccess(
      fastify.db,
      parsed.data.clerkUserId,
      parsed.data.projectId
    );
    if (!allowed) return reply.code(404).send({ error: { code: "NOT_FOUND" } });
    return reply.code(200).send({ ok: true });
  });
}
