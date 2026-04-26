import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  createProjectRequestSchema,
  projectResponseSchema,
  updateProjectRequestSchema,
} from "@remarks/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assertProjectMember } from "../../lib/project-authorization.js";
import {
  createProject,
  deleteProject,
  getProjectBySlug,
  listProjectsByOrg,
  updateProject,
} from "../../services/project.service.js";
import { protectedProcedure, router } from "../trpc.js";

const listInputSchema = z.object({ orgId: z.string().min(1) });
const listOutputSchema = z.object({ items: z.array(projectResponseSchema) });

const createInputSchema = z.object({
  orgId: z.string().min(1),
  input: createProjectRequestSchema,
});

const getBySlugInputSchema = z.object({
  orgId: z.string().min(1),
  slug: z.string().min(1),
});

const updateInputSchema = z.object({
  projectId: z.string().uuid(),
  input: updateProjectRequestSchema,
});

const deleteInputSchema = z.object({
  projectId: z.string().uuid(),
});

export const projectsRouter = router({
  list: protectedProcedure.input(listInputSchema).query(async ({ ctx, input }) => {
    const membership = ctx.orgMemberships.find((m) => m.clerkOrgId === input.orgId);
    if (!membership) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Not a member of this organization",
        cause: new ForbiddenError("Not a member of this organization"),
      });
    }
    const items = await listProjectsByOrg(ctx.db, input.orgId, ctx.user.id);
    return listOutputSchema.parse({ items });
  }),

  getBySlug: protectedProcedure.input(getBySlugInputSchema).query(async ({ ctx, input }) => {
    const membership = ctx.orgMemberships.find((m) => m.clerkOrgId === input.orgId);
    if (!membership) {
      // Match `list`'s behavior: non-members get FORBIDDEN rather than NOT_FOUND
      // on the org membership check. Project existence is leak-proofed separately
      // inside getProjectBySlug, which also throws NotFoundError when the org
      // is unknown to the DB.
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Not a member of this organization",
        cause: new ForbiddenError("Not a member of this organization"),
      });
    }
    try {
      const result = await getProjectBySlug(ctx.db, input.orgId, input.slug, ctx.user.id);
      return projectResponseSchema.parse(result);
    } catch (err) {
      if (err instanceof NotFoundError) {
        throw new TRPCError({ code: "NOT_FOUND", message: err.message, cause: err });
      }
      throw err;
    }
  }),

  create: protectedProcedure.input(createInputSchema).mutation(async ({ ctx, input }) => {
    const membership = ctx.orgMemberships.find(
      (m) => m.clerkOrgId === input.orgId && m.role === "org:admin"
    );
    if (!membership) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Org admin role required to create a project",
        cause: new ForbiddenError("Org admin role required to create a project"),
      });
    }

    try {
      const result = await createProject(ctx.db, {
        clerkOrgId: input.orgId,
        authorUserId: ctx.user.id,
        input: input.input,
        clerk: ctx.clerk,
      });
      return projectResponseSchema.parse(result);
    } catch (err) {
      if (err instanceof ConflictError) {
        throw new TRPCError({ code: "CONFLICT", message: err.message, cause: err });
      }
      if (err instanceof NotFoundError) {
        throw new TRPCError({ code: "NOT_FOUND", message: err.message, cause: err });
      }
      throw err;
    }
  }),

  update: protectedProcedure.input(updateInputSchema).mutation(async ({ ctx, input }) => {
    try {
      // assertProjectMember throws NotFoundError for non-members so existence
      // isn't leaked to callers who aren't on the member list, and
      // ForbiddenError when the caller is a member but not an admin.
      await assertProjectMember(ctx.db, ctx.user.id, input.projectId, {
        minRole: "admin",
      });
      const result = await updateProject(ctx.db, {
        projectId: input.projectId,
        callerUserId: ctx.user.id,
        input: input.input,
      });
      return projectResponseSchema.parse(result);
    } catch (err) {
      if (err instanceof ForbiddenError) {
        throw new TRPCError({ code: "FORBIDDEN", message: err.message, cause: err });
      }
      if (err instanceof NotFoundError) {
        throw new TRPCError({ code: "NOT_FOUND", message: err.message, cause: err });
      }
      if (err instanceof ConflictError) {
        throw new TRPCError({ code: "CONFLICT", message: err.message, cause: err });
      }
      throw err;
    }
  }),

  delete: protectedProcedure.input(deleteInputSchema).mutation(async ({ ctx, input }) => {
    try {
      await assertProjectMember(ctx.db, ctx.user.id, input.projectId, {
        minRole: "admin",
      });
      await deleteProject(ctx.db, input.projectId);
      return { id: input.projectId };
    } catch (err) {
      if (err instanceof ForbiddenError) {
        throw new TRPCError({ code: "FORBIDDEN", message: err.message, cause: err });
      }
      if (err instanceof NotFoundError) {
        throw new TRPCError({ code: "NOT_FOUND", message: err.message, cause: err });
      }
      throw err;
    }
  }),
});
