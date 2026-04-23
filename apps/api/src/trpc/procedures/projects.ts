import { ForbiddenError, projectResponseSchema } from "@remarks/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { listProjectsByOrg } from "../../services/project.service.js";
import { protectedProcedure, router } from "../trpc.js";

const listInputSchema = z.object({ orgId: z.string().min(1) });
const listOutputSchema = z.object({ items: z.array(projectResponseSchema) });

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
});
