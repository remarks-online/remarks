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

export interface AnnotationAccessResult {
  // Null for personal annotations (caller is the owner). Project role for
  // project-scoped annotations.
  role: ProjectRole | null;
  isOwner: boolean;
}

// Pure (no FastifyRequest) variant of authorizeAnnotationAccess for tRPC
// callers. Personal annotations: the caller must be the author. Project
// annotations: the caller must be a project member meeting `minRole`.
// Existence-leak posture: NotFoundError on any deny.
export async function assertAnnotationAccess(
  db: DB,
  userId: string,
  ownership: { projectId: string | null; authorId: string },
  opts: { minRole?: ProjectRole } = {}
): Promise<AnnotationAccessResult> {
  if (ownership.projectId === null) {
    if (ownership.authorId !== userId) {
      throw new NotFoundError("Annotation");
    }
    return { role: null, isOwner: true };
  }
  const { role } = await assertProjectMember(db, userId, ownership.projectId, opts);
  return { role, isOwner: ownership.authorId === userId };
}
