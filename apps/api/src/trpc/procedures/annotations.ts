import {
  ForbiddenError,
  NotFoundError,
  annotationListResponseSchema,
  listAnnotationsQuerySchema,
} from "@remarks/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assertProjectMember } from "../../lib/project-authorization.js";
import { listAnnotations } from "../../services/annotation.service.js";
import { protectedProcedure, router } from "../trpc.js";

const listInputSchema = listAnnotationsQuerySchema.extend({
  projectId: z.string().uuid(),
});

export const annotationsRouter = router({
  list: protectedProcedure.input(listInputSchema).query(async ({ ctx, input }) => {
    try {
      await assertProjectMember(ctx.db, ctx.user.id, input.projectId);
    } catch (err) {
      if (err instanceof NotFoundError) {
        throw new TRPCError({ code: "NOT_FOUND", message: err.message, cause: err });
      }
      if (err instanceof ForbiddenError) {
        throw new TRPCError({ code: "FORBIDDEN", message: err.message, cause: err });
      }
      throw err;
    }

    const { projectId, ...query } = input;
    const result = await listAnnotations(ctx.db, {
      projectId,
      query,
      r2: ctx.r2,
    });
    return annotationListResponseSchema.parse(result);
  }),
});
