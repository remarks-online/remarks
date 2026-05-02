import {
  ForbiddenError,
  ValidationError,
  annotationIntentSchema,
  annotationSeveritySchema,
  annotationStatusSchema,
  createAnnotationRequestSchema,
  listAnnotationsQuerySchema,
  updateAnnotationRequestSchema,
} from "@remarks/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  PROJECT_ROLE_RANK,
  authorizeAnnotationAccess,
  requireProjectMember,
} from "../../lib/authorization.js";
import {
  createAnnotation,
  deleteAnnotation,
  getAnnotationById,
  getAnnotationOwnership,
  listAnnotationEvents,
  listAnnotations,
  listAnnotationsForUser,
  updateAnnotation,
} from "../../services/annotation.service.js";

const projectParamsSchema = z.object({
  projectId: z.string().uuid(),
});

const annotationParamsSchema = z.object({
  annotationId: z.string().uuid(),
});

export async function annotationRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/projects/:projectId/annotations", async (request, reply) => {
    const paramsResult = projectParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      throw new ValidationError("Invalid path params", paramsResult.error.issues);
    }
    const { projectId } = paramsResult.data;

    await requireProjectMember(request, projectId);

    const queryResult = listAnnotationsQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      throw new ValidationError("Invalid query params", queryResult.error.issues);
    }

    // The shared REST query schema exposes single-value filters (back-compat
    // with existing dashboard / extension callers). The service signature
    // accepts arrays so the internal MCP route can multi-filter; wrap once
    // here.
    const { status, intent, severity, ...rest } = queryResult.data;
    const result = await listAnnotations(request.server.db, {
      projectId,
      query: {
        ...rest,
        statuses: status ? [status] : undefined,
        intents: intent ? [intent] : undefined,
        severities: severity ? [severity] : undefined,
      },
      r2: request.server.r2,
    });
    return reply.send(result);
  });

  fastify.post("/projects/:projectId/annotations", async (request, reply) => {
    const paramsResult = projectParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      throw new ValidationError("Invalid path params", paramsResult.error.issues);
    }
    const { projectId } = paramsResult.data;

    await requireProjectMember(request, projectId, { minRole: "editor" });

    // Spec example omits projectId from body (path-authoritative). Inject it
    // before validation so the shared schema continues to require a UUID here.
    const bodyWithPath = {
      ...(typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {}),
      projectId,
    };
    const bodyResult = createAnnotationRequestSchema.safeParse(bodyWithPath);
    if (!bodyResult.success) {
      throw new ValidationError("Invalid request body", bodyResult.error.issues);
    }

    // The auth middleware only allows non-soft-deleted users to reach this
    // route, so email is guaranteed non-null here. Guarding anyway because
    // the DB column is nullable and the response schema isn't.
    const authorEmail = request.auth.user.email;
    if (!authorEmail) {
      throw new ValidationError("Authenticated user has no email address");
    }

    const response = await createAnnotation(request.server.db, {
      author: {
        id: request.auth.user.id,
        email: authorEmail,
        name: request.auth.user.name,
        avatarUrl: request.auth.user.avatarUrl,
      },
      input: bodyResult.data,
      r2: request.server.r2,
      publisher: request.server.annotationEventBus,
      inngest: request.server.inngest,
    });

    return reply.code(201).send(response);
  });

  fastify.get("/annotations/:annotationId", async (request, reply) => {
    const paramsResult = annotationParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      throw new ValidationError("Invalid path params", paramsResult.error.issues);
    }
    const { annotationId } = paramsResult.data;

    // Authorize before loading the full row + assets so non-members don't pay
    // the R2 presign cost. authorizeAnnotationAccess returns 404 for both
    // non-members and non-owners-of-personal so existence isn't leaked.
    const ownership = await getAnnotationOwnership(request.server.db, annotationId);
    await authorizeAnnotationAccess(request, ownership);

    const response = await getAnnotationById(request.server.db, annotationId, request.server.r2);
    return reply.send(response);
  });

  fastify.get("/annotations/:annotationId/events", async (request, reply) => {
    const paramsResult = annotationParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      throw new ValidationError("Invalid path params", paramsResult.error.issues);
    }
    const { annotationId } = paramsResult.data;

    const ownership = await getAnnotationOwnership(request.server.db, annotationId);
    await authorizeAnnotationAccess(request, ownership);

    const events = await listAnnotationEvents(request.server.db, annotationId);
    return reply.send({ events });
  });

  fastify.patch("/annotations/:annotationId", async (request, reply) => {
    const paramsResult = annotationParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      throw new ValidationError("Invalid path params", paramsResult.error.issues);
    }
    const { annotationId } = paramsResult.data;

    const bodyResult = updateAnnotationRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      throw new ValidationError("Invalid request body", bodyResult.error.issues);
    }

    const ownership = await getAnnotationOwnership(request.server.db, annotationId);
    const { role, isOwner } = await authorizeAnnotationAccess(request, ownership);
    if (role !== null && PROJECT_ROLE_RANK[role] < PROJECT_ROLE_RANK.editor && !isOwner) {
      throw new ForbiddenError("Requires project editor role or annotation author");
    }

    const response = await updateAnnotation(request.server.db, {
      annotationId,
      actorId: request.auth.user.id,
      input: bodyResult.data,
      r2: request.server.r2,
      publisher: request.server.annotationEventBus,
      inngest: request.server.inngest,
    });
    return reply.send(response);
  });

  fastify.delete("/annotations/:annotationId", async (request, reply) => {
    const paramsResult = annotationParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      throw new ValidationError("Invalid path params", paramsResult.error.issues);
    }
    const { annotationId } = paramsResult.data;

    const ownership = await getAnnotationOwnership(request.server.db, annotationId);
    const { role, isOwner } = await authorizeAnnotationAccess(request, ownership);
    if (role !== null && PROJECT_ROLE_RANK[role] < PROJECT_ROLE_RANK.admin && !isOwner) {
      throw new ForbiddenError("Requires project admin role or annotation author");
    }

    await deleteAnnotation(request.server.db, request.server.inngest, annotationId);
    return reply.code(204).send();
  });

  // Personal capture: signed-in only, no project membership required. Body
  // mirrors the project-scoped path but omits projectId/branch.
  fastify.post("/annotations", async (request, reply) => {
    const bodyResult = createAnnotationRequestSchema.safeParse(request.body);
    if (!bodyResult.success) {
      throw new ValidationError("Invalid request body", bodyResult.error.issues);
    }
    if (bodyResult.data.projectId || bodyResult.data.branch) {
      throw new ValidationError(
        "Personal capture must omit projectId and branch; use /projects/:projectId/annotations to share with a team"
      );
    }

    const authorEmail = request.auth.user.email;
    if (!authorEmail) {
      throw new ValidationError("Authenticated user has no email address");
    }

    const response = await createAnnotation(request.server.db, {
      author: {
        id: request.auth.user.id,
        email: authorEmail,
        name: request.auth.user.name,
        avatarUrl: request.auth.user.avatarUrl,
      },
      input: bodyResult.data,
      r2: request.server.r2,
      publisher: request.server.annotationEventBus,
    });
    return reply.code(201).send(response);
  });

  // Per-user list. Returns the caller's accessible annotations: their personal
  // ones plus any project annotations they're a member of. The `url` filter is
  // the primary way the extension fetches "what's at this URL?" — without it,
  // this is the dashboard's "all my annotations" feed.
  fastify.get("/annotations", async (request, reply) => {
    const queryResult = userAnnotationsQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      throw new ValidationError("Invalid query params", queryResult.error.issues);
    }
    const { status, intent, severity, ...rest } = queryResult.data;
    const result = await listAnnotationsForUser(request.server.db, {
      userId: request.auth.user.id,
      query: {
        ...rest,
        statuses: status ? [status] : undefined,
        intents: intent ? [intent] : undefined,
        severities: severity ? [severity] : undefined,
      },
      r2: request.server.r2,
    });
    return reply.send(result);
  });
}

const userAnnotationsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: annotationStatusSchema.optional(),
  intent: annotationIntentSchema.optional(),
  severity: annotationSeveritySchema.optional(),
  url: z.string().url().optional(),
  scope: z.enum(["personal", "all"]).optional(),
});
