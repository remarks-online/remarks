import {
  ForbiddenError,
  NotFoundError,
  RemarksError,
  annotationEventListResponseSchema,
  annotationListResponseSchema,
  annotationResponseSchema,
  listAnnotationsQuerySchema,
  updateAnnotationRequestSchema,
} from "@remarks/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { PROJECT_ROLE_RANK, assertProjectMember } from "../../lib/project-authorization.js";
import {
  getAnnotationById,
  getAnnotationOwnership,
  listAnnotationEvents,
  listAnnotations,
  updateAnnotation,
} from "../../services/annotation.service.js";
import { protectedProcedure, router } from "../trpc.js";

// Map RemarksError subclasses to TRPCError codes. tRPC's error formatter
// (trpc.ts) already handles RemarksError thrown inside the procedure body,
// but callers that wrap or rethrow need the explicit mapping.
function mapError(err: unknown): never {
  if (err instanceof NotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: err.message, cause: err });
  }
  if (err instanceof ForbiddenError) {
    throw new TRPCError({ code: "FORBIDDEN", message: err.message, cause: err });
  }
  if (err instanceof RemarksError) throw err;
  throw err;
}

const listInputSchema = listAnnotationsQuerySchema.extend({
  projectId: z.string().uuid(),
});

const annotationIdInputSchema = z.object({ id: z.string().uuid() });

const updateInputSchema = z.object({
  id: z.string().uuid(),
  input: updateAnnotationRequestSchema,
});

export const annotationsRouter = router({
  list: protectedProcedure.input(listInputSchema).query(async ({ ctx, input }) => {
    try {
      await assertProjectMember(ctx.db, ctx.user.id, input.projectId);
    } catch (err) {
      mapError(err);
    }

    const { projectId, status, ...rest } = input;
    // listInputSchema mirrors the REST query (single-status); the service
    // takes a multi-status array for the internal MCP path. Wrap to one-element.
    const result = await listAnnotations(ctx.db, {
      projectId,
      query: { ...rest, statuses: status ? [status] : undefined },
      r2: ctx.r2,
    });
    return annotationListResponseSchema.parse(result);
  }),

  get: protectedProcedure.input(annotationIdInputSchema).query(async ({ ctx, input }) => {
    try {
      const ownership = await getAnnotationOwnership(ctx.db, input.id);
      await assertProjectMember(ctx.db, ctx.user.id, ownership.projectId);
      const response = await getAnnotationById(ctx.db, input.id, ctx.r2);
      return annotationResponseSchema.parse(response);
    } catch (err) {
      mapError(err);
    }
  }),

  listEvents: protectedProcedure.input(annotationIdInputSchema).query(async ({ ctx, input }) => {
    try {
      const ownership = await getAnnotationOwnership(ctx.db, input.id);
      await assertProjectMember(ctx.db, ctx.user.id, ownership.projectId);
      const events = await listAnnotationEvents(ctx.db, input.id);
      return annotationEventListResponseSchema.parse({ events });
    } catch (err) {
      mapError(err);
    }
  }),

  update: protectedProcedure.input(updateInputSchema).mutation(async ({ ctx, input }) => {
    try {
      const ownership = await getAnnotationOwnership(ctx.db, input.id);
      const { role } = await assertProjectMember(ctx.db, ctx.user.id, ownership.projectId);
      const isAuthor = ownership.authorId === ctx.user.id;
      if (PROJECT_ROLE_RANK[role] < PROJECT_ROLE_RANK.editor && !isAuthor) {
        throw new ForbiddenError("Requires project editor role or annotation author");
      }
      const response = await updateAnnotation(ctx.db, {
        annotationId: input.id,
        actorId: ctx.user.id,
        input: input.input,
        r2: ctx.r2,
      });
      return annotationResponseSchema.parse(response);
    } catch (err) {
      mapError(err);
    }
  }),
});
