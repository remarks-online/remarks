import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  createProjectRequestSchema,
  projectResponseSchema,
} from "@remarks/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createProject, listProjectsByOrg } from "../../services/project.service.js";
import { protectedProcedure, router } from "../trpc.js";

const listInputSchema = z.object({ orgId: z.string().min(1) });
const listOutputSchema = z.object({ items: z.array(projectResponseSchema) });

const createInputSchema = z.object({
  orgId: z.string().min(1),
  input: createProjectRequestSchema,
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
