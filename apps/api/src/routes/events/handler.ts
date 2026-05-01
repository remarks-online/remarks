import type { AnnotationStreamEvent } from "@remarks/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../../env.js";
import { type Subscriber, type SubscriberFilter, matches } from "../../lib/annotation-event-bus.js";
import { startSseResponse } from "../../lib/sse.js";
import {
  REPLAY_LIMIT,
  replayProjectEventsSince,
  replayUserEventsSince,
} from "../../services/event-stream.service.js";

export interface StreamHandlerArgs {
  fastify: FastifyInstance;
  request: FastifyRequest;
  reply: FastifyReply;
  filter: SubscriberFilter;
}

// Wires up an SSE response for the given filter:
//   1. Read the resume cursor (Last-Event-ID header > ?since= query).
//   2. Subscribe to the broker into a local pending queue (so we don't miss
//      events that fire during replay).
//   3. Replay buffered → DB-backed history if a cursor was provided.
//   4. Drain the pending queue (skipping ids the replay already covered).
//   5. Flip the sink to direct delivery for the live stream.
export async function streamAnnotationEvents(args: StreamHandlerArgs): Promise<void> {
  const { fastify, request, reply, filter } = args;
  const sinceId = readResumeId(request);

  // Ensure the LISTEN connection is attached before we subscribe + replay.
  // First call starts the listener; subsequent calls are a no-op. Errors
  // surface as 500 before any SSE headers go out.
  await fastify.annotationEventBus.start();

  const channel = startSseResponse(request, reply, {
    maxConnectionMs: env.MAX_SSE_CONNECTION_MS,
  });

  // Phase 1 sink: buffer until replay completes. Phase 2: direct send.
  let live = false;
  const pending: AnnotationStreamEvent[] = [];

  const sink = (event: AnnotationStreamEvent): void => {
    if (live) {
      writeEvent(event, channel.sendEvent);
    } else {
      pending.push(event);
    }
  };

  const subscriber: Subscriber =
    filter.kind === "project"
      ? { kind: "project", projectId: filter.projectId, sink }
      : { kind: "user", userId: filter.userId, projectIds: filter.projectIds, sink };

  let handle: { unsubscribe(): void };
  try {
    handle = fastify.annotationEventBus.subscribe(subscriber);
  } catch (err) {
    // SseConnectionLimitError: surface a normal HTTP error before any SSE
    // headers go out. The channel.close() winds back the hijacked response.
    channel.close();
    throw err;
  }

  channel.onClose(() => handle.unsubscribe());

  let latestDeliveredId: string | null = null;

  // ── Replay ────────────────────────────────────────────────────────────
  if (sinceId !== null) {
    const buffered = fastify.annotationEventBus.replayBuffered(filter, sinceId);
    if (buffered !== null) {
      // Buffer hit — replay the matching window without touching the DB.
      for (const ev of buffered) {
        writeEvent(ev, channel.sendEvent);
        latestDeliveredId = ev.id;
      }
    } else {
      // Cursor missed the in-memory window — fall back to a single DB read,
      // capped at REPLAY_LIMIT.
      try {
        const result =
          filter.kind === "project"
            ? await replayProjectEventsSince(fastify.db, filter.projectId, sinceId)
            : await replayUserEventsSince(fastify.db, {
                userId: filter.userId,
                projectIds: filter.projectIds,
                sinceId,
              });
        for (const ev of result.events) {
          writeEvent(ev, channel.sendEvent);
          latestDeliveredId = ev.id;
        }
        if (result.truncated) {
          channel.sendEvent({
            id: latestDeliveredId ?? sinceId,
            event: "replay_truncated",
            data: { limit: REPLAY_LIMIT },
          });
        }
      } catch (err) {
        request.log.error({ err }, "annotation event replay failed");
        channel.sendEvent({
          id: sinceId,
          event: "replay_error",
          data: { code: "REPLAY_ERROR" },
        });
      }
    }
  }

  // ── Drain the pending queue (events that arrived during replay). ──────
  for (const ev of pending) {
    if (latestDeliveredId !== null && ev.id <= latestDeliveredId) continue;
    if (!matches(filter, ev)) continue; // defensive — broker already filtered
    writeEvent(ev, channel.sendEvent);
    latestDeliveredId = ev.id;
  }
  pending.length = 0;
  live = true;
}

function readResumeId(request: FastifyRequest): string | null {
  const header = request.headers["last-event-id"];
  if (typeof header === "string" && header.length > 0) return header;
  // ?since=<resumeId>
  const query = request.query as { since?: unknown } | undefined;
  if (query && typeof query.since === "string" && query.since.length > 0) {
    return query.since;
  }
  return null;
}

function writeEvent(
  event: AnnotationStreamEvent,
  send: (args: { id: string; event: string; data: unknown }) => void
): void {
  send({ id: event.id, event: event.type, data: event });
}
