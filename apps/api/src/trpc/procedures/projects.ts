import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  createProjectRequestSchema,
  projectResponseSchema,
} from "@remarks/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createProject,
  getProjectBySlug,
  listProjectsByOrg,
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
    const items = await listProjectsByOrg(ctx.db, input.orgId);
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
      const result = await getProjectBySlug(ctx.db, input.orgId, input.slug);
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
});
