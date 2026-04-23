import { schema } from "@remarks/db";
import { ForbiddenError, NotFoundError } from "@remarks/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";

export type ProjectRole = "viewer" | "editor" | "admin";

export const PROJECT_ROLE_RANK: Record<ProjectRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
};

const CLERK_ADMIN_ROLE = "org:admin";

export function requireOrgMember(
  request: FastifyRequest,
  clerkOrgId: string,
  opts: { role?: "admin" } = {}
): { clerkOrgId: string; role: string } {
  const membership = request.auth.orgMemberships.find((m) => m.clerkOrgId === clerkOrgId);
  if (!membership) {
    throw new ForbiddenError("Not a member of this organization");
  }
  if (opts.role === "admin" && membership.role !== CLERK_ADMIN_ROLE) {
    throw new ForbiddenError("Requires organization admin");
  }
  return membership;
}

export async function requireProjectMember(
  request: FastifyRequest,
  projectId: string,
  opts: { minRole?: ProjectRole } = {}
): Promise<{ role: ProjectRole }> {
  const minRole = opts.minRole ?? "viewer";
  const row = await request.server.db.query.projectMembers.findFirst({
    where: and(
      eq(schema.projectMembers.projectId, projectId),
      eq(schema.projectMembers.userId, request.auth.user.id)
    ),
    columns: { role: true },
  });
  // Return 404 on missing membership so project existence isn't leaked to non-members.
  if (!row) {
    throw new NotFoundError("Project");
  }
  if (PROJECT_ROLE_RANK[row.role] < PROJECT_ROLE_RANK[minRole]) {
    throw new ForbiddenError(`Requires project ${minRole} role`);
  }
  return { role: row.role };
}
