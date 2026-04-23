import { type DB, schema } from "@remarks/db";
import {
  ConflictError,
  type CreateProjectRequest,
  NotFoundError,
  type ProjectResponse,
} from "@remarks/shared";
import { and, eq } from "drizzle-orm";
import { isUniqueViolation } from "../lib/db-errors.js";

export interface CreateProjectArgs {
  clerkOrgId: string;
  authorUserId: string;
  input: CreateProjectRequest;
}

function toProjectResponse(row: typeof schema.projects.$inferSelect): ProjectResponse {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    slug: row.slug,
    gitRepoUrl: row.gitRepoUrl,
    primaryBranch: row.primaryBranch,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createProject(db: DB, args: CreateProjectArgs): Promise<ProjectResponse> {
  const { clerkOrgId, authorUserId, input } = args;

  return await db.transaction(async (tx) => {
    const org = await tx.query.organizations.findFirst({
      where: eq(schema.organizations.clerkOrgId, clerkOrgId),
      columns: { id: true },
    });
    if (!org) {
      throw new NotFoundError("Organization");
    }

    let inserted: typeof schema.projects.$inferSelect;
    try {
      const [row] = await tx
        .insert(schema.projects)
        .values({
          orgId: org.id,
          name: input.name,
          slug: input.slug,
          gitRepoUrl: input.gitRepoUrl ?? null,
          primaryBranch: input.primaryBranch,
        })
        .returning();
      if (!row) throw new Error("project insert returned no rows");
      inserted = row;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError("Project slug already exists in this organization");
      }
      throw err;
    }

    await tx.insert(schema.projectMembers).values({
      projectId: inserted.id,
      userId: authorUserId,
      role: "admin",
    });

    return toProjectResponse(inserted);
  });
}

export async function listProjectsByOrg(db: DB, clerkOrgId: string): Promise<ProjectResponse[]> {
  const org = await db.query.organizations.findFirst({
    where: eq(schema.organizations.clerkOrgId, clerkOrgId),
    columns: { id: true },
  });
  if (!org) {
    throw new NotFoundError("Organization");
  }

  const rows = await db.query.projects.findMany({
    where: eq(schema.projects.orgId, org.id),
    orderBy: (projects, { desc }) => [desc(projects.createdAt)],
  });
  return rows.map(toProjectResponse);
}

export async function getProjectById(db: DB, projectId: string): Promise<ProjectResponse> {
  const row = await db.query.projects.findFirst({
    where: eq(schema.projects.id, projectId),
  });
  if (!row) {
    throw new NotFoundError("Project");
  }
  return toProjectResponse(row);
}

export async function getProjectBySlug(
  db: DB,
  clerkOrgId: string,
  slug: string
): Promise<ProjectResponse> {
  // Slugs are unique per-org (see projects_org_slug_idx). Resolving through the
  // clerk org id keeps the lookup scoped so cross-org slug collisions never leak.
  const org = await db.query.organizations.findFirst({
    where: eq(schema.organizations.clerkOrgId, clerkOrgId),
    columns: { id: true },
  });
  if (!org) {
    throw new NotFoundError("Project");
  }
  const row = await db.query.projects.findFirst({
    where: and(eq(schema.projects.orgId, org.id), eq(schema.projects.slug, slug)),
  });
  if (!row) {
    throw new NotFoundError("Project");
  }
  return toProjectResponse(row);
}
