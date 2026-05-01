import type { Sql } from "@remarks/db";
import type { AnnotationStreamEvent } from "@remarks/shared";
import { describe, expect, test } from "vitest";
import {
  AnnotationEventBus,
  SseConnectionLimitError,
  buildAnnotationStreamEvent,
} from "./annotation-event-bus.js";

// Stubs — never reached in unit tests since we use ingestForTest() to drive
// dispatch. publish()/listen() in production touch Sql but tests don't.
const stubNotifySql = {} as unknown as Sql;
const stubListenSql = {} as unknown as Sql;

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "33333333-3333-4333-8333-333333333333";
const USER_B = "44444444-4444-4444-8444-444444444444";
const ANNOTATION_X = "55555555-5555-4555-8555-555555555555";

let counter = 0;
function fakeEvent(args: {
  projectId: string | null;
  authorId: string;
  type?: AnnotationStreamEvent["type"];
}): AnnotationStreamEvent {
  counter += 1;
  const createdAt = new Date(Date.parse("2026-04-30T00:00:00Z") + counter * 1000);
  const eventId = `aaaaaaaa-aaaa-4aaa-8aaa-${String(counter).padStart(12, "0")}`;
  return buildAnnotationStreamEvent({
    eventId,
    type: args.type ?? "created",
    payload: {},
    createdAt,
    actorType: "user",
    actorId: args.authorId,
    actorOauthClientId: null,
    annotationId: ANNOTATION_X,
    projectId: args.projectId,
    authorId: args.authorId,
  });
}

function makeBus(maxConnections = 100, bufferSize = 32): AnnotationEventBus {
  return new AnnotationEventBus({
    notifySql: stubNotifySql,
    listenSql: stubListenSql,
    maxConnections,
    bufferSize,
  });
}

describe("AnnotationEventBus fan-out", () => {
  test("project subscriber receives only matching project events", () => {
    const bus = makeBus();
    const received: AnnotationStreamEvent[] = [];
    bus.subscribe({
      kind: "project",
      projectId: PROJECT_A,
      sink: (ev) => received.push(ev),
    });

    bus.ingestForTest(fakeEvent({ projectId: PROJECT_A, authorId: USER_A }));
    bus.ingestForTest(fakeEvent({ projectId: PROJECT_B, authorId: USER_A }));
    bus.ingestForTest(fakeEvent({ projectId: null, authorId: USER_A }));

    expect(received).toHaveLength(1);
    expect(received[0]?.projectId).toBe(PROJECT_A);
  });

  test("user subscriber receives personal events authored by them", () => {
    const bus = makeBus();
    const received: AnnotationStreamEvent[] = [];
    bus.subscribe({
      kind: "user",
      userId: USER_A,
      projectIds: new Set(),
      sink: (ev) => received.push(ev),
    });

    bus.ingestForTest(fakeEvent({ projectId: null, authorId: USER_A }));
    bus.ingestForTest(fakeEvent({ projectId: null, authorId: USER_B }));

    expect(received).toHaveLength(1);
    expect(received[0]?.authorId).toBe(USER_A);
  });

  test("user subscriber receives events on member projects", () => {
    const bus = makeBus();
    const received: AnnotationStreamEvent[] = [];
    bus.subscribe({
      kind: "user",
      userId: USER_A,
      projectIds: new Set([PROJECT_A]),
      sink: (ev) => received.push(ev),
    });

    bus.ingestForTest(fakeEvent({ projectId: PROJECT_A, authorId: USER_B }));
    bus.ingestForTest(fakeEvent({ projectId: PROJECT_B, authorId: USER_B }));

    expect(received).toHaveLength(1);
    expect(received[0]?.projectId).toBe(PROJECT_A);
  });

  test("multiple subscribers on same project all receive the event", () => {
    const bus = makeBus();
    const a: AnnotationStreamEvent[] = [];
    const b: AnnotationStreamEvent[] = [];
    bus.subscribe({ kind: "project", projectId: PROJECT_A, sink: (ev) => a.push(ev) });
    bus.subscribe({ kind: "project", projectId: PROJECT_A, sink: (ev) => b.push(ev) });

    bus.ingestForTest(fakeEvent({ projectId: PROJECT_A, authorId: USER_A }));

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  test("unsubscribe stops further delivery and decrements size", () => {
    const bus = makeBus();
    const received: AnnotationStreamEvent[] = [];
    const handle = bus.subscribe({
      kind: "project",
      projectId: PROJECT_A,
      sink: (ev) => received.push(ev),
    });
    expect(bus.size()).toBe(1);

    bus.ingestForTest(fakeEvent({ projectId: PROJECT_A, authorId: USER_A }));
    handle.unsubscribe();
    expect(bus.size()).toBe(0);
    bus.ingestForTest(fakeEvent({ projectId: PROJECT_A, authorId: USER_A }));

    expect(received).toHaveLength(1);
  });
});

describe("AnnotationEventBus buffer + replay", () => {
  test("ring buffer evicts oldest when size exceeded", () => {
    const bus = makeBus(100, 3);
    for (let i = 0; i < 5; i += 1) {
      bus.ingestForTest(fakeEvent({ projectId: PROJECT_A, authorId: USER_A }));
    }
    expect(bus.bufferLength()).toBe(3);
  });

  test("replayBuffered returns null when cursor is not in buffer", () => {
    const bus = makeBus();
    bus.ingestForTest(fakeEvent({ projectId: PROJECT_A, authorId: USER_A }));
    const result = bus.replayBuffered(
      { kind: "project", projectId: PROJECT_A },
      "1900-01-01T00:00:00.000Z:00000000-0000-0000-0000-000000000000"
    );
    expect(result).toBeNull();
  });

  test("replayBuffered returns matching events strictly after cursor", () => {
    const bus = makeBus();
    const e1 = fakeEvent({ projectId: PROJECT_A, authorId: USER_A });
    const e2 = fakeEvent({ projectId: PROJECT_B, authorId: USER_A });
    const e3 = fakeEvent({ projectId: PROJECT_A, authorId: USER_A });
    bus.ingestForTest(e1);
    bus.ingestForTest(e2);
    bus.ingestForTest(e3);

    const result = bus.replayBuffered({ kind: "project", projectId: PROJECT_A }, e1.id);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result?.[0]?.id).toBe(e3.id);
  });
});

describe("AnnotationEventBus connection cap", () => {
  test("subscribe past maxConnections throws SseConnectionLimitError", () => {
    const bus = makeBus(2);
    bus.subscribe({ kind: "project", projectId: PROJECT_A, sink: () => {} });
    bus.subscribe({ kind: "project", projectId: PROJECT_B, sink: () => {} });
    expect(() => bus.subscribe({ kind: "project", projectId: PROJECT_A, sink: () => {} })).toThrow(
      SseConnectionLimitError
    );
  });

  test("unsubscribing makes room for new subscribers", () => {
    const bus = makeBus(1);
    const h = bus.subscribe({ kind: "project", projectId: PROJECT_A, sink: () => {} });
    expect(() => bus.subscribe({ kind: "project", projectId: PROJECT_A, sink: () => {} })).toThrow(
      SseConnectionLimitError
    );
    h.unsubscribe();
    bus.subscribe({ kind: "project", projectId: PROJECT_A, sink: () => {} });
    expect(bus.size()).toBe(1);
  });
});

describe("AnnotationEventBus error isolation", () => {
  test("a throwing sink doesn't stop other subscribers", () => {
    const bus = makeBus();
    const received: AnnotationStreamEvent[] = [];
    bus.subscribe({
      kind: "project",
      projectId: PROJECT_A,
      sink: () => {
        throw new Error("boom");
      },
    });
    bus.subscribe({
      kind: "project",
      projectId: PROJECT_A,
      sink: (ev) => received.push(ev),
    });
    bus.ingestForTest(fakeEvent({ projectId: PROJECT_A, authorId: USER_A }));
    expect(received).toHaveLength(1);
  });
});
