import type { ClerkClient } from "@clerk/backend";
import { type DB, schema } from "@remarks/db";
import {
  ConflictError,
  type CreateProjectRequest,
  NotFoundError,
  type ProjectResponse,
  type ProjectRole,
  type UpdateProjectRequest,
} from "@remarks/shared";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { AppInngest } from "../inngest/client.js";
import { publishR2Cleanup } from "../inngest/publish.js";
import { isUniqueViolation } from "../lib/db-errors.js";
import { provisionUserFromClerk } from "./clerk-sync.service.js";

export interface CreateProjectArgs {
  // Null creates a personal project owned by `authorUserId`; only the creator
  // gets a project_members row and the Clerk org fan-out is skipped.
  clerkOrgId: string | null;
  authorUserId: string;
  input: CreateProjectRequest;
  clerk: ClerkClient;
}

export interface UpdateProjectArgs {
  projectId: string;
  callerUserId: string;
  input: UpdateProjectRequest;
}

function toProjectResponse(
  row: typeof schema.projects.$inferSelect,
  myRole: ProjectRole | null
): ProjectResponse {
  return {
    id: row.id,
    orgId: row.orgId,
    creatorUserId: row.creatorUserId,
    name: row.name,
    slug: row.slug,
    gitRepoUrl: row.gitRepoUrl,
    primaryBranch: row.primaryBranch,
    myRole,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createProject(db: DB, args: CreateProjectArgs): Promise<ProjectResponse> {
  const { clerkOrgId, authorUserId, input, clerk } = args;

  // Personal project: skip the Clerk org-membership fan-out entirely. The
  // creator is the only `project_members` row.
  if (clerkOrgId === null) {
    return await db.transaction(async (tx) => {
      let inserted: typeof schema.projects.$inferSelect;
      try {
        const [row] = await tx
          .insert(schema.projects)
          .values({
            orgId: null,
            creatorUserId: authorUserId,
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
          throw new ConflictError("Project slug already exists in your personal projects");
        }
        throw err;
      }

      await tx.insert(schema.projectMembers).values({
        projectId: inserted.id,
        userId: authorUserId,
        role: "admin",
      });

      return toProjectResponse(inserted, "admin");
    });
  }

  // Fetch the org's full Clerk membership list outside the DB transaction —
  // it's a network call to Clerk and we don't want it holding a Postgres txn
  // open. The fan-out below mints `editor` rows for every other member so an
  // already-invited teammate sees the new project immediately, not just on
  // their next webhook-driven sync.
  const memberships = await clerk.organizations.getOrganizationMembershipList({
    organizationId: clerkOrgId,
    limit: 500,
  });
  const otherClerkUserIds = memberships.data
    .map((m) => m.publicUserData?.userId)
    .filter((id): id is string => typeof id === "string");

  // Resolve every Clerk member's local users.id, lazily provisioning rows for
  // anyone the user.created webhook hasn't reached yet (parallels the auth
  // plugin's user backstop). Empty `coMemberIds` is the common case: the
  // creator's own row is inserted as `admin` regardless.
  const coMemberIds: string[] = [];
  for (const clerkUserId of otherClerkUserIds) {
    const existing = await db.query.users.findFirst({
      where: eq(schema.users.clerkUserId, clerkUserId),
      columns: { id: true },
    });
    if (existing) {
      if (existing.id !== authorUserId) coMemberIds.push(existing.id);
      continue;
    }
    const provisioned = await provisionUserFromClerk(db, clerk, clerkUserId);
    if (provisioned && provisioned.id !== authorUserId) coMemberIds.push(provisioned.id);
  }

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
          creatorUserId: authorUserId,
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

    if (coMemberIds.length > 0) {
      await tx
        .insert(schema.projectMembers)
        .values(
          coMemberIds.map((userId) => ({
            projectId: inserted.id,
            userId,
            role: "editor" as const,
          }))
        )
        .onConflictDoNothing();
    }

    // Creator is always admin of the new project.
    return toProjectResponse(inserted, "admin");
  });
}

export async function listProjectsByOrg(
  db: DB,
  clerkOrgId: string,
  callerUserId: string
): Promise<ProjectResponse[]> {
  const org = await db.query.organizations.findFirst({
    where: eq(schema.organizations.clerkOrgId, clerkOrgId),
    columns: { id: true },
  });
  if (!org) {
    throw new NotFoundError("Organization");
  }

  // LEFT JOIN project_members so org members who aren't yet on a project still
  // see the project row with myRole=null. The callerUserId join condition keeps
  // it to one row per project.
  const rows = await db
    .select({ project: schema.projects, role: schema.projectMembers.role })
    .from(schema.projects)
    .leftJoin(
      schema.projectMembers,
      and(
        eq(schema.projectMembers.projectId, schema.projects.id),
        eq(schema.projectMembers.userId, callerUserId)
      )
    )
    .where(eq(schema.projects.orgId, org.id))
    .orderBy(desc(schema.projects.createdAt));
  return rows.map((r) => toProjectResponse(r.project, r.role));
}

export async function listPersonalProjects(
  db: DB,
  callerUserId: string
): Promise<ProjectResponse[]> {
  const rows = await db
    .select({ project: schema.projects, role: schema.projectMembers.role })
    .from(schema.projects)
    .leftJoin(
      schema.projectMembers,
      and(
        eq(schema.projectMembers.projectId, schema.projects.id),
        eq(schema.projectMembers.userId, callerUserId)
      )
    )
    .where(and(isNull(schema.projects.orgId), eq(schema.projects.creatorUserId, callerUserId)))
    .orderBy(desc(schema.projects.createdAt));
  return rows.map((r) => toProjectResponse(r.project, r.role));
}

export async function getProjectById(
  db: DB,
  projectId: string,
  callerUserId: string
): Promise<ProjectResponse> {
  const [row] = await db
    .select({ project: schema.projects, role: schema.projectMembers.role })
    .from(schema.projects)
    .leftJoin(
      schema.projectMembers,
      and(
        eq(schema.projectMembers.projectId, schema.projects.id),
        eq(schema.projectMembers.userId, callerUserId)
      )
    )
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  if (!row) {
    throw new NotFoundError("Project");
  }
  return toProjectResponse(row.project, row.role);
}

export async function updateProject(db: DB, args: UpdateProjectArgs): Promise<ProjectResponse> {
  const { projectId, callerUserId, input } = args;

  // Distinguish absent keys from explicit nulls so callers can clear gitRepoUrl
  // by passing `null` while leaving other fields untouched.
  const set: Partial<typeof schema.projects.$inferInsert> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) set.name = input.name;
  if (input.slug !== undefined) set.slug = input.slug;
  if ("gitRepoUrl" in input) set.gitRepoUrl = input.gitRepoUrl ?? null;
  if (input.primaryBranch !== undefined) set.primaryBranch = input.primaryBranch;

  try {
    const [row] = await db
      .update(schema.projects)
      .set(set)
      .where(eq(schema.projects.id, projectId))
      .returning();
    if (!row) {
      throw new NotFoundError("Project");
    }
    // Caller is asserted as admin upstream; we don't re-query project_members here.
    return toProjectResponse(row, await fetchCallerRole(db, projectId, callerUserId));
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError("Project slug already exists in this scope");
    }
    throw err;
  }
}

async function fetchCallerRole(
  db: DB,
  projectId: string,
  callerUserId: string
): Promise<ProjectRole | null> {
  const row = await db.query.projectMembers.findFirst({
    where: and(
      eq(schema.projectMembers.projectId, projectId),
      eq(schema.projectMembers.userId, callerUserId)
    ),
    columns: { role: true },
  });
  return row?.role ?? null;
}

export async function deleteProject(db: DB, inngest: AppInngest, projectId: string): Promise<void> {
  // Capture every R2 key for assets attached to annotations under this
  // project — FK cascade obliterates the rows otherwise.
  const assetKeys = await db
    .select({ r2Key: schema.annotationAssets.r2Key })
    .from(schema.annotationAssets)
    .innerJoin(schema.annotations, eq(schema.annotations.id, schema.annotationAssets.annotationId))
    .where(eq(schema.annotations.projectId, projectId));

  // FK cascades on project_members, branches, annotations, annotation_assets,
  // annotation_events, project_api_tokens handle children.
  const deleted = await db
    .delete(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .returning({ id: schema.projects.id });
  if (deleted.length === 0) {
    throw new NotFoundError("Project");
  }

  await publishR2Cleanup(
    inngest,
    assetKeys.map((k) => k.r2Key),
    `project:${projectId}`
  );
}

export async function getProjectBySlug(
  db: DB,
  clerkOrgId: string | null,
  slug: string,
  callerUserId: string
): Promise<ProjectResponse> {
  // When clerkOrgId is null, resolve in personal scope (creator-owned, no org).
  if (clerkOrgId === null) {
    const [row] = await db
      .select({ project: schema.projects, role: schema.projectMembers.role })
      .from(schema.projects)
      .leftJoin(
        schema.projectMembers,
        and(
          eq(schema.projectMembers.projectId, schema.projects.id),
          eq(schema.projectMembers.userId, callerUserId)
        )
      )
      .where(
        and(
          isNull(schema.projects.orgId),
          eq(schema.projects.creatorUserId, callerUserId),
          eq(schema.projects.slug, slug)
        )
      )
      .limit(1);
    if (!row) {
      throw new NotFoundError("Project");
    }
    return toProjectResponse(row.project, row.role);
  }

  // Org scope: resolve the local org id first to keep lookups fully scoped so
  // cross-org slug collisions never leak.
  const org = await db.query.organizations.findFirst({
    where: eq(schema.organizations.clerkOrgId, clerkOrgId),
    columns: { id: true },
  });
  if (!org) {
    throw new NotFoundError("Project");
  }
  const [row] = await db
    .select({ project: schema.projects, role: schema.projectMembers.role })
    .from(schema.projects)
    .leftJoin(
      schema.projectMembers,
      and(
        eq(schema.projectMembers.projectId, schema.projects.id),
        eq(schema.projectMembers.userId, callerUserId)
      )
    )
    .where(and(eq(schema.projects.orgId, org.id), eq(schema.projects.slug, slug)))
    .limit(1);
  if (!row) {
    throw new NotFoundError("Project");
  }
  return toProjectResponse(row.project, row.role);
}
