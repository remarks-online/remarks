import { schema } from "@remarks/db";
import {
  type AnnotationEventType,
  type AnnotationIntent,
  type AnnotationResponse,
  type AnnotationSeverity,
  type AnnotationStatus,
  type AnnotationStreamEvent,
  ValidationError,
  annotationEventTypeSchema,
  annotationIntentSchema,
  annotationSeveritySchema,
  annotationStatusSchema,
} from "@remarks/shared";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { assertProjectMember } from "../../lib/project-authorization.js";
import { getAnnotationById } from "../../services/annotation.service.js";
import {
  collectAnnotationEvents,
  loadUserProjectIds,
} from "../../services/event-stream.service.js";
import {
  MCP_SCREENSHOT_GET_TTL_SECONDS,
  type McpAnnotationRow,
  agentUpdateAnnotationStatus,
  resolveMcpUserId,
  userHasOrgAccess,
} from "../../services/mcp.service.js";

// G10: long-poll endpoint pair that powers `remarks_watch_annotations`. The
// SSE handler streams forever; this returns a single batch with each
// annotation hydrated inline so the agent can act without a follow-up
// `remarks_get_task`. Auto-acknowledge fires after we've collected events
// (and unsubscribed from the bus) so our own `agent_acknowledged` writes
// don't feed back into the same response — they show up on the next call.

const projectParamsSchema = z.object({
  projectId: z.string().uuid(),
});

const userParamsSchema = z.object({
  clerkUserId: z.string().min(1),
});

// CSV-encoded array param. The watch endpoint's filter axes (intent,
// severity, status, event_types) all accept multiple values; encoding them
// as `?intent=fix,change` keeps the URL short and matches the convention
// already used by `?statuses=` on the existing list endpoints.
const csvList = <T extends string>(parser: z.ZodType<T>) =>
  z
    .string()
    .optional()
    .transform((value, ctx): T[] | undefined => {
      if (value === undefined || value === "") return undefined;
      const parts = value
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const result: T[] = [];
      for (const part of parts) {
        const parsed = parser.safeParse(part);
        if (!parsed.success) {
          ctx.addIssue({
            code: "custom",
            message: `Invalid value: ${part}`,
          });
          return z.NEVER;
        }
        result.push(parsed.data);
      }
      return result.length > 0 ? result : undefined;
    });

// Shared filter / long-poll knobs across both routes.
const baseQuerySchema = z.object({
  since: z.string().min(1).optional(),
  intent: csvList(annotationIntentSchema),
  severity: csvList(annotationSeveritySchema),
  status: csvList(annotationStatusSchema),
  event_types: csvList(annotationEventTypeSchema),
  branch: z.string().min(1).optional(),
  wait_seconds: z.coerce.number().int().min(0).max(55).default(30),
  batch_window_ms: z.coerce.number().int().min(0).max(2000).default(250),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  auto_acknowledge: z.coerce.boolean().default(false),
  // The OAuth client name is required when auto_acknowledge is on, since the
  // resulting `agent_acknowledged` event needs an attribution string. We
  // accept it on every request and only look at it when needed.
  oauthClientName: z.string().min(1).optional(),
});

const projectQuerySchema = baseQuerySchema.extend({
  clerkUserId: z.string().min(1),
});

const userQuerySchema = baseQuerySchema.extend({
  mode: z.enum(["personal", "all", "org"]).default("all"),
  orgId: z.string().uuid().optional(),
});

interface WatchEventResponse {
  streamEvent: AnnotationStreamEvent;
  annotation: McpAnnotationRow | null;
  autoAcknowledged: boolean;
}

interface WatchResponseBody {
  events: WatchEventResponse[];
  nextCursor: string | null;
  idle: boolean;
  replayTruncated: boolean;
  moreAvailable: boolean;
}

interface ApplyFiltersOptions {
  intents: ReadonlySet<AnnotationIntent> | undefined;
  severities: ReadonlySet<AnnotationSeverity> | undefined;
  statuses: ReadonlySet<AnnotationStatus> | undefined;
  branch: string | undefined;
}

function passesAnnotationFilters(
  annotation: AnnotationResponse | null,
  opts: ApplyFiltersOptions
): boolean {
  // Deletion events have no current annotation row. We can't apply the
  // annotation-side filters, so they're treated as failing every annotation
  // filter — agents who care about deletions can pass `event_types` and
  // omit the annotation filters.
  if (annotation === null) {
    return (
      opts.intents === undefined &&
      opts.severities === undefined &&
      opts.statuses === undefined &&
      opts.branch === undefined
    );
  }
  if (opts.intents !== undefined) {
    if (annotation.intent === null || !opts.intents.has(annotation.intent)) return false;
  }
  if (opts.severities !== undefined) {
    if (annotation.severity === null || !opts.severities.has(annotation.severity)) return false;
  }
  if (opts.statuses !== undefined) {
    if (!opts.statuses.has(annotation.status)) return false;
  }
  if (opts.branch !== undefined) {
    if (annotation.branchName !== opts.branch) return false;
  }
  return true;
}

interface HydrateAndAckArgs {
  fastify: FastifyInstance;
  events: AnnotationStreamEvent[];
  filters: ApplyFiltersOptions;
  autoAcknowledge: boolean;
  clerkUserId: string;
  oauthClientName: string | null;
}

async function hydrateAndAutoAck(args: HydrateAndAckArgs): Promise<WatchEventResponse[]> {
  const { fastify, events, filters, autoAcknowledge, clerkUserId, oauthClientName } = args;
  // Hydrate concurrently. ≤ limit (default 25, cap 100), so a parallel
  // `Promise.all` is fine — same shape as listAnnotationsForUser's per-row
  // R2 presigning.
  const hydrated = await Promise.all(
    events.map(async (streamEvent) => {
      try {
        const annotation = await getAnnotationById(
          fastify.db,
          streamEvent.annotationId,
          fastify.r2,
          {
            assetTtlSeconds: MCP_SCREENSHOT_GET_TTL_SECONDS,
          }
        );
        return { streamEvent, annotation };
      } catch {
        // Annotation deleted or otherwise unreadable — surface a null
        // snapshot. The wire schema permits `annotation: null`.
        return { streamEvent, annotation: null as AnnotationResponse | null };
      }
    })
  );

  // Auto-acknowledge dedup'd by annotationId — multiple events on the same
  // annotation in one batch only ack once.
  const autoAckedAnnotationIds = new Set<string>();
  if (autoAcknowledge && oauthClientName !== null) {
    for (const item of hydrated) {
      if (item.annotation === null) continue;
      if (item.annotation.status !== "to_do") continue;
      if (autoAckedAnnotationIds.has(item.annotation.id)) continue;
      try {
        await agentUpdateAnnotationStatus(fastify.db, {
          annotationId: item.annotation.id,
          clerkUserId,
          oauthClientName,
          status: "acknowledged",
          publisher: fastify.annotationEventBus,
          inngest: fastify.inngest,
        });
        autoAckedAnnotationIds.add(item.annotation.id);
      } catch (err) {
        // A best-effort side effect — if the ack write fails (race with a
        // status change, network blip), log and move on. The agent still
        // gets the event delivered.
        fastify.log.warn(
          { err, annotationId: item.annotation.id },
          "watch auto_acknowledge failed"
        );
      }
    }
  }

  // Apply post-hydration filters AFTER auto-ack so the agent's view of
  // `auto_acknowledged: true` matches the real side-effect set.
  const out: WatchEventResponse[] = [];
  for (const item of hydrated) {
    if (!passesAnnotationFilters(item.annotation, filters)) continue;
    const annotation: McpAnnotationRow | null =
      item.annotation === null
        ? null
        : { ...item.annotation, frameworkHint: item.annotation.frameworkHint };
    out.push({
      streamEvent: item.streamEvent,
      annotation,
      autoAcknowledged: item.annotation ? autoAckedAnnotationIds.has(item.annotation.id) : false,
    });
  }
  return out;
}

function nextCursorFor(events: AnnotationStreamEvent[], since: string | null): string | null {
  // Events are emitted in chronological order from the collector — the
  // newest delivered id is the right resume cursor.
  const last = events.at(-1);
  if (last === undefined) return since;
  return last.id;
}

function asReadonlySet<T extends string>(values: T[] | undefined): ReadonlySet<T> | undefined {
  if (values === undefined || values.length === 0) return undefined;
  return new Set(values);
}

export async function watchInternalRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/internal/mcp/projects/:projectId/watch", async (request, reply) => {
    const paramsResult = projectParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      throw new ValidationError("Invalid path params", paramsResult.error.issues);
    }
    const queryResult = projectQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      throw new ValidationError("Invalid query params", queryResult.error.issues);
    }
    const { projectId } = paramsResult.data;
    const q = queryResult.data;

    if (q.auto_acknowledge && q.oauthClientName === undefined) {
      throw new ValidationError("oauthClientName is required when auto_acknowledge=true");
    }

    const userId = await resolveMcpUserId(fastify.db, q.clerkUserId);
    // Existence-leak posture matches the SSE handler: non-members surface as 404.
    await assertProjectMember(fastify.db, userId, projectId);

    const eventTypes = asReadonlySet<AnnotationEventType>(q.event_types);
    const collected = await collectAnnotationEvents({
      fastify,
      filter: { kind: "project", projectId },
      sinceId: q.since ?? null,
      waitMs: q.wait_seconds * 1000,
      batchWindowMs: q.batch_window_ms,
      limit: q.limit,
      ...(eventTypes !== undefined ? { eventTypes } : {}),
    });

    const events = await hydrateAndAutoAck({
      fastify,
      events: collected.events,
      filters: {
        intents: asReadonlySet<AnnotationIntent>(q.intent),
        severities: asReadonlySet<AnnotationSeverity>(q.severity),
        statuses: asReadonlySet<AnnotationStatus>(q.status),
        branch: q.branch,
      },
      autoAcknowledge: q.auto_acknowledge,
      clerkUserId: q.clerkUserId,
      oauthClientName: q.oauthClientName ?? null,
    });

    const body: WatchResponseBody = {
      events,
      nextCursor: nextCursorFor(collected.events, q.since ?? null),
      idle: collected.events.length === 0 && collected.idleTimeout,
      replayTruncated: collected.replayTruncated,
      moreAvailable: collected.events.length >= q.limit,
    };
    return reply.code(200).send(body);
  });

  fastify.get("/internal/mcp/users/:clerkUserId/watch", async (request, reply) => {
    const paramsResult = userParamsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      throw new ValidationError("Invalid path params", paramsResult.error.issues);
    }
    const queryResult = userQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      throw new ValidationError("Invalid query params", queryResult.error.issues);
    }
    const { clerkUserId } = paramsResult.data;
    const q = queryResult.data;

    if (q.auto_acknowledge && q.oauthClientName === undefined) {
      throw new ValidationError("oauthClientName is required when auto_acknowledge=true");
    }
    if (q.mode === "org" && q.orgId === undefined) {
      throw new ValidationError("orgId is required when mode=org");
    }

    const userId = await resolveMcpUserId(fastify.db, clerkUserId);

    let projectIds: ReadonlySet<string>;
    if (q.mode === "personal") {
      projectIds = new Set();
    } else if (q.mode === "org") {
      // biome-ignore lint/style/noNonNullAssertion: validated above
      const orgId = q.orgId!;
      const allowed = await userHasOrgAccess(fastify.db, clerkUserId, orgId);
      if (!allowed) return reply.code(404).send({ message: "Org not found" });
      const all = await loadUserProjectIds(fastify.db, userId);
      if (all.size === 0) {
        projectIds = new Set();
      } else {
        const orgRows = await fastify.db
          .select({ id: schema.projects.id })
          .from(schema.projects)
          .where(and(eq(schema.projects.orgId, orgId), inArray(schema.projects.id, [...all])));
        projectIds = new Set(orgRows.map((r) => r.id));
      }
    } else {
      projectIds = await loadUserProjectIds(fastify.db, userId);
    }

    const eventTypes = asReadonlySet<AnnotationEventType>(q.event_types);
    const collected = await collectAnnotationEvents({
      fastify,
      filter: { kind: "user", userId, projectIds },
      sinceId: q.since ?? null,
      waitMs: q.wait_seconds * 1000,
      batchWindowMs: q.batch_window_ms,
      limit: q.limit,
      ...(eventTypes !== undefined ? { eventTypes } : {}),
    });

    const events = await hydrateAndAutoAck({
      fastify,
      events: collected.events,
      filters: {
        intents: asReadonlySet<AnnotationIntent>(q.intent),
        severities: asReadonlySet<AnnotationSeverity>(q.severity),
        statuses: asReadonlySet<AnnotationStatus>(q.status),
        branch: q.branch,
      },
      autoAcknowledge: q.auto_acknowledge,
      clerkUserId,
      oauthClientName: q.oauthClientName ?? null,
    });

    const body: WatchResponseBody = {
      events,
      nextCursor: nextCursorFor(collected.events, q.since ?? null),
      idle: collected.events.length === 0 && collected.idleTimeout,
      replayTruncated: collected.replayTruncated,
      moreAvailable: collected.events.length >= q.limit,
    };
    return reply.code(200).send(body);
  });
}
