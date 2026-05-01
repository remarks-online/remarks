import type { Sql } from "@remarks/db";
import {
  type AnnotationEventType,
  type AnnotationStreamEvent,
  type EventActorType,
  RemarksError,
  annotationStreamEventSchema,
  buildStreamEventId,
} from "@remarks/shared";

// Loose-typed publisher contract — services accept this so they don't have to
// import the bus class directly. Pass `request.server.annotationEventBus`.
export interface AnnotationEventPublisher {
  publish(event: AnnotationStreamEvent): Promise<void>;
}

export interface BuildAnnotationStreamEventInput {
  eventId: string;
  type: AnnotationEventType;
  payload: Record<string, unknown>;
  createdAt: Date;
  actorType: EventActorType;
  actorId: string | null;
  actorOauthClientId: string | null;
  annotationId: string;
  projectId: string | null;
  authorId: string;
}

// Materialize the wire envelope from a freshly-inserted annotationEvents row
// plus the annotation's projectId/authorId. Services call this after the
// transaction commits so a rolled-back write never broadcasts.
export function buildAnnotationStreamEvent(
  input: BuildAnnotationStreamEventInput
): AnnotationStreamEvent {
  return {
    id: buildStreamEventId(input.createdAt, input.eventId),
    type: input.type,
    annotationId: input.annotationId,
    projectId: input.projectId,
    authorId: input.authorId,
    actorType: input.actorType,
    actorId: input.actorId,
    actorOauthClientId: input.actorOauthClientId,
    payload: input.payload,
    createdAt: input.createdAt.toISOString(),
  };
}

// Channel name for the LISTEN/NOTIFY broadcast. Single channel keeps the
// listener bookkeeping trivial; per-project / per-user routing happens in
// memory inside the broker.
export const ANNOTATION_EVENTS_CHANNEL = "annotation_events";

export type Sink = (event: AnnotationStreamEvent) => void;

export type ProjectSubscriber = {
  kind: "project";
  projectId: string;
  sink: Sink;
};

export type UserSubscriber = {
  kind: "user";
  userId: string;
  // Project ids the user is a member of, frozen at subscribe time.
  projectIds: ReadonlySet<string>;
  sink: Sink;
};

export type Subscriber = ProjectSubscriber | UserSubscriber;

export interface SubscribeHandle {
  unsubscribe(): void;
}

export class SseConnectionLimitError extends RemarksError {
  constructor(limit: number) {
    super(`SSE connection limit (${limit}) reached`, "SSE_CONNECTION_LIMIT", 503, true);
  }
}

export interface AnnotationEventBusOptions {
  // Shared application pool — used only for the brief `pg_notify` SELECT.
  notifySql: Sql;
  // Dedicated single-connection client used for LISTEN. Must NOT be the same
  // pool as `notifySql`; calling `sql.listen` on the shared pool can interfere
  // with concurrent operations on it (observed during integration-test setup).
  listenSql: Sql;
  // Inclusive cap on concurrent subscribers across all kinds. New subscribes
  // beyond the cap throw SseConnectionLimitError.
  maxConnections: number;
  // Size of the in-memory replay ring buffer (one buffer for the whole bus).
  // Resumes outside the buffer fall back to a DB read on the route layer.
  bufferSize: number;
  // Optional logger surface — accepts the Fastify logger or any pino-like.
  logger?: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

export class AnnotationEventBus {
  private readonly notifySql: Sql;
  private readonly listenSql: Sql;
  private readonly maxConnections: number;
  private readonly bufferSize: number;
  private readonly logger: AnnotationEventBusOptions["logger"];

  private readonly projectSubs = new Map<string, Set<ProjectSubscriber>>();
  private readonly userSubs = new Map<string, Set<UserSubscriber>>();
  private subscriberCount = 0;

  // Ring buffer: append at end, drop from front when over capacity. O(1) push,
  // O(n) replay scan — fine for n=256.
  private readonly buffer: AnnotationStreamEvent[] = [];

  private listenerHandle: { unlisten: () => Promise<void> } | null = null;
  private starting: Promise<void> | null = null;
  private closed = false;

  constructor(opts: AnnotationEventBusOptions) {
    this.notifySql = opts.notifySql;
    this.listenSql = opts.listenSql;
    this.maxConnections = opts.maxConnections;
    this.bufferSize = opts.bufferSize;
    this.logger = opts.logger;
  }

  // Idempotent. Most callers leave the listener cold and rely on subscribe()
  // to start it on demand — the integration test harness boots many Fastify
  // instances back-to-back, and an eagerly-attached LISTEN socket from a
  // previous instance was observed to interfere with subsequent test setup.
  async start(): Promise<void> {
    if (this.listenerHandle) return;
    if (this.closed) return;
    if (this.starting) {
      await this.starting;
      return;
    }
    const promise = (async () => {
      const handle = await this.listenSql.listen(ANNOTATION_EVENTS_CHANNEL, (payload: string) => {
        this.onNotification(payload);
      });
      this.listenerHandle = handle;
      this.logger?.info?.({ channel: ANNOTATION_EVENTS_CHANNEL }, "annotation event bus listening");
    })();
    this.starting = promise;
    try {
      await promise;
    } finally {
      this.starting = null;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.listenerHandle) {
      try {
        await this.listenerHandle.unlisten();
      } catch (err) {
        this.logger?.warn?.({ err }, "annotation event bus unlisten failed");
      }
      this.listenerHandle = null;
    }
    try {
      await this.listenSql.end({ timeout: 5 });
    } catch (err) {
      this.logger?.warn?.({ err }, "annotation event bus listenSql end failed");
    }
    // Drain any subscribers — sinks are responsible for closing their HTTP
    // streams when invoked with a `null`-equivalent signal. We send no event
    // here; the SSE layer wires its own onClose listener via unsubscribe().
    this.projectSubs.clear();
    this.userSubs.clear();
    this.subscriberCount = 0;
  }

  // Service code calls this *after* its db.transaction commits. Failing to
  // notify is logged but never thrown — analytics-style fire-and-forget so a
  // broker hiccup never fails an annotation write.
  async publish(event: AnnotationStreamEvent): Promise<void> {
    if (this.closed) return;
    const payload = JSON.stringify(event);
    try {
      await this.notifySql`SELECT pg_notify(${ANNOTATION_EVENTS_CHANNEL}, ${payload})`;
    } catch (err) {
      this.logger?.error?.({ err, eventId: event.id }, "annotation NOTIFY failed");
    }
  }

  subscribe(sub: Subscriber): SubscribeHandle {
    if (this.closed) {
      throw new SseConnectionLimitError(this.maxConnections);
    }
    if (this.subscriberCount >= this.maxConnections) {
      throw new SseConnectionLimitError(this.maxConnections);
    }
    if (sub.kind === "project") {
      const set = this.projectSubs.get(sub.projectId) ?? new Set<ProjectSubscriber>();
      set.add(sub);
      this.projectSubs.set(sub.projectId, set);
    } else {
      const set = this.userSubs.get(sub.userId) ?? new Set<UserSubscriber>();
      set.add(sub);
      this.userSubs.set(sub.userId, set);
    }
    this.subscriberCount += 1;
    // Start the LISTEN connection on first real subscriber. Awaited
    // asynchronously — events that arrive before the LISTEN attaches are
    // simply not delivered (the route's replay path covers reconnects).
    if (!this.listenerHandle && !this.starting) {
      void this.start().catch((err) =>
        this.logger?.error?.({ err }, "annotation event bus deferred start failed")
      );
    }
    return {
      unsubscribe: () => this.unsubscribe(sub),
    };
  }

  // Replay buffered events strictly newer than `sinceId`. Returns null when
  // the resume cursor isn't in the buffer at all (caller must read from the
  // DB), or a chronologically-ordered slice that may be empty when nothing
  // matches. Callers compare the slice length against the requested cap to
  // know whether to mark `replay_truncated`.
  replayBuffered(filter: SubscriberFilter, sinceId: string): AnnotationStreamEvent[] | null {
    let started = false;
    const out: AnnotationStreamEvent[] = [];
    for (const ev of this.buffer) {
      if (!started) {
        if (ev.id === sinceId) started = true;
        continue;
      }
      if (matches(filter, ev)) out.push(ev);
    }
    return started ? out : null;
  }

  size(): number {
    return this.subscriberCount;
  }

  bufferLength(): number {
    return this.buffer.length;
  }

  private unsubscribe(sub: Subscriber): void {
    if (sub.kind === "project") {
      const set = this.projectSubs.get(sub.projectId);
      if (set?.delete(sub)) this.subscriberCount -= 1;
      if (set && set.size === 0) this.projectSubs.delete(sub.projectId);
    } else {
      const set = this.userSubs.get(sub.userId);
      if (set?.delete(sub)) this.subscriberCount -= 1;
      if (set && set.size === 0) this.userSubs.delete(sub.userId);
    }
  }

  // Visible for tests — pushes an event through the same code path the LISTEN
  // handler does. Production never calls this directly; we go DB→LISTEN.
  ingestForTest(event: AnnotationStreamEvent): void {
    this.dispatch(event);
  }

  private onNotification(payload: string): void {
    let parsed: AnnotationStreamEvent;
    try {
      parsed = annotationStreamEventSchema.parse(JSON.parse(payload));
    } catch (err) {
      this.logger?.warn?.({ err, payload }, "annotation event bus: dropped malformed payload");
      return;
    }
    this.dispatch(parsed);
  }

  private dispatch(event: AnnotationStreamEvent): void {
    this.appendBuffer(event);
    // Per-project fan-out.
    if (event.projectId !== null) {
      const projectSet = this.projectSubs.get(event.projectId);
      if (projectSet) {
        for (const sub of projectSet) safeSink(sub.sink, event, this.logger);
      }
    }
    // Per-user fan-out — applies to every per-user subscriber whose membership
    // set includes this project, plus the personal-author case.
    if (event.projectId === null) {
      const userSet = this.userSubs.get(event.authorId);
      if (userSet) {
        for (const sub of userSet) safeSink(sub.sink, event, this.logger);
      }
    } else {
      // Iterate only the userSubs map keys whose subscriber lists watch this
      // project. The Map is keyed by userId, so we walk all values and filter
      // by projectIds membership. For typical fleet sizes (few hundred
      // subscribers) this is fine; if it ever isn't, swap to a project→user
      // index.
      for (const set of this.userSubs.values()) {
        for (const sub of set) {
          if (sub.projectIds.has(event.projectId)) safeSink(sub.sink, event, this.logger);
        }
      }
    }
  }

  private appendBuffer(event: AnnotationStreamEvent): void {
    this.buffer.push(event);
    while (this.buffer.length > this.bufferSize) this.buffer.shift();
  }
}

export type SubscriberFilter =
  | { kind: "project"; projectId: string }
  | { kind: "user"; userId: string; projectIds: ReadonlySet<string> };

export function matches(filter: SubscriberFilter, event: AnnotationStreamEvent): boolean {
  if (filter.kind === "project") {
    return event.projectId === filter.projectId;
  }
  if (event.projectId === null) {
    return event.authorId === filter.userId;
  }
  return filter.projectIds.has(event.projectId);
}

function safeSink(
  sink: Sink,
  event: AnnotationStreamEvent,
  logger: AnnotationEventBusOptions["logger"]
): void {
  try {
    sink(event);
  } catch (err) {
    logger?.warn?.({ err, eventId: event.id }, "sse sink threw");
  }
}
