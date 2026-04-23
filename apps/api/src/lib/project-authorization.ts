import { type DB, schema } from "@remarks/db";
import { ForbiddenError, NotFoundError } from "@remarks/shared";
import { and, eq } from "drizzle-orm";

export type ProjectRole = "viewer" | "editor" | "admin";

export const PROJECT_ROLE_RANK: Record<ProjectRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
};

export async function assertProjectMember(
  db: DB,
  userId: string,
  projectId: string,
  opts: { minRole?: ProjectRole } = {}
): Promise<{ role: ProjectRole }> {
  const minRole = opts.minRole ?? "viewer";
  const row = await db.query.projectMembers.findFirst({
    where: and(
      eq(schema.projectMembers.projectId, projectId),
      eq(schema.projectMembers.userId, userId)
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
