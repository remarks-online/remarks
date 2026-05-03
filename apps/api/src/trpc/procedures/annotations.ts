import {
  ForbiddenError,
  NotFoundError,
  RemarksError,
  annotationEventListResponseSchema,
  annotationIntentSchema,
  annotationListResponseSchema,
  annotationResponseSchema,
  annotationSeveritySchema,
  annotationStatusSchema,
  listAnnotationsQuerySchema,
  updateAnnotationRequestSchema,
} from "@remarks/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  PROJECT_ROLE_RANK,
  assertAnnotationAccess,
  assertProjectMember,
} from "../../lib/project-authorization.js";
import {
  deleteAnnotation,
  getAnnotationById,
  getAnnotationOwnership,
  listAnnotationEvents,
  listAnnotations,
  listAnnotationsForUser,
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

const listForUserInputSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  status: annotationStatusSchema.optional(),
  intent: annotationIntentSchema.optional(),
  severity: annotationSeveritySchema.optional(),
  url: z.string().url().optional(),
  scope: z.enum(["personal", "all"]).optional(),
  // G17: detail-sheet "Linked annotations" fetch.
  groupId: z.string().uuid().optional(),
});

export const annotationsRouter = router({
  list: protectedProcedure.input(listInputSchema).query(async ({ ctx, input }) => {
    try {
      await assertProjectMember(ctx.db, ctx.user.id, input.projectId);
    } catch (err) {
      mapError(err);
    }

    const { projectId, status, intent, severity, groupId, ...rest } = input;
    // listInputSchema mirrors the REST query (single-value filters); the
    // service takes multi-value arrays for the internal MCP path. Wrap once.
    const result = await listAnnotations(ctx.db, {
      projectId,
      query: {
        ...rest,
        statuses: status ? [status] : undefined,
        intents: intent ? [intent] : undefined,
        severities: severity ? [severity] : undefined,
        groupIds: groupId ? [groupId] : undefined,
      },
      r2: ctx.r2,
    });
    return annotationListResponseSchema.parse(result);
  }),

  get: protectedProcedure.input(annotationIdInputSchema).query(async ({ ctx, input }) => {
    try {
      const ownership = await getAnnotationOwnership(ctx.db, input.id);
      await assertAnnotationAccess(ctx.db, ctx.user.id, ownership);
      const response = await getAnnotationById(ctx.db, input.id, ctx.r2);
      return annotationResponseSchema.parse(response);
    } catch (err) {
      mapError(err);
    }
  }),

  listEvents: protectedProcedure.input(annotationIdInputSchema).query(async ({ ctx, input }) => {
    try {
      const ownership = await getAnnotationOwnership(ctx.db, input.id);
      await assertAnnotationAccess(ctx.db, ctx.user.id, ownership);
      const events = await listAnnotationEvents(ctx.db, input.id);
      return annotationEventListResponseSchema.parse({ events });
    } catch (err) {
      mapError(err);
    }
  }),

  // Returns annotations the caller can see across personal + project scopes.
  // The `url` filter scopes to a single page (used by the extension sidebar in
  // personal mode); without it, this is the dashboard's "all my annotations"
  // feed. Personal-only via scope: "personal".
  listForUser: protectedProcedure.input(listForUserInputSchema).query(async ({ ctx, input }) => {
    try {
      const { status, intent, severity, groupId, ...rest } = input;
      const result = await listAnnotationsForUser(ctx.db, {
        userId: ctx.user.id,
        query: {
          ...rest,
          statuses: status ? [status] : undefined,
          intents: intent ? [intent] : undefined,
          severities: severity ? [severity] : undefined,
          groupIds: groupId ? [groupId] : undefined,
        },
        r2: ctx.r2,
      });
      return annotationListResponseSchema.parse(result);
    } catch (err) {
      mapError(err);
    }
  }),

  update: protectedProcedure.input(updateInputSchema).mutation(async ({ ctx, input }) => {
    try {
      const ownership = await getAnnotationOwnership(ctx.db, input.id);
      const { role, isOwner } = await assertAnnotationAccess(ctx.db, ctx.user.id, ownership);
      if (role !== null && PROJECT_ROLE_RANK[role] < PROJECT_ROLE_RANK.editor && !isOwner) {
        throw new ForbiddenError("Requires project editor role or annotation author");
      }
      const response = await updateAnnotation(ctx.db, {
        annotationId: input.id,
        actorId: ctx.user.id,
        input: input.input,
        r2: ctx.r2,
        publisher: ctx.annotationEventBus,
        inngest: ctx.inngest,
      });
      return annotationResponseSchema.parse(response);
    } catch (err) {
      mapError(err);
    }
  }),

  delete: protectedProcedure.input(annotationIdInputSchema).mutation(async ({ ctx, input }) => {
    try {
      const ownership = await getAnnotationOwnership(ctx.db, input.id);
      const { role, isOwner } = await assertAnnotationAccess(ctx.db, ctx.user.id, ownership);
      if (role !== null && PROJECT_ROLE_RANK[role] < PROJECT_ROLE_RANK.editor && !isOwner) {
        throw new ForbiddenError("Requires project editor role or annotation author");
      }
      await deleteAnnotation(ctx.db, ctx.inngest, input.id);
      return { ok: true } as const;
    } catch (err) {
      mapError(err);
    }
  }),
});
