import { describe, expect, test } from "vitest";
import {
  annotationEventListResponseSchema,
  annotationEventResponseSchema,
} from "./annotation-event.js";

const baseUserEvent = {
  id: "00000000-0000-4000-8000-000000000010",
  annotationId: "00000000-0000-4000-8000-000000000020",
  type: "status_changed" as const,
  actorType: "user" as const,
  actor: {
    id: "00000000-0000-4000-8000-000000000030",
    name: "Dev",
    email: "dev@example.com",
    avatarUrl: null,
  },
  payload: { from: "to_do", to: "doing" },
  createdAt: "2026-04-22T12:00:00.000Z",
};

describe("annotationEventResponseSchema", () => {
  test("accepts a user-authored event", () => {
    expect(annotationEventResponseSchema.safeParse(baseUserEvent).success).toBe(true);
  });

  test("accepts a system event with null actor", () => {
    expect(
      annotationEventResponseSchema.safeParse({
        ...baseUserEvent,
        type: "resolved",
        actorType: "system",
        actor: null,
        payload: {},
      }).success
    ).toBe(true);
  });

  test("rejects unknown event type", () => {
    expect(
      annotationEventResponseSchema.safeParse({ ...baseUserEvent, type: "nope" }).success
    ).toBe(false);
  });

  test("rejects non-ISO createdAt", () => {
    expect(
      annotationEventResponseSchema.safeParse({ ...baseUserEvent, createdAt: "yesterday" }).success
    ).toBe(false);
  });
});

describe("annotationEventListResponseSchema", () => {
  test("accepts an empty events array", () => {
    expect(annotationEventListResponseSchema.safeParse({ events: [] }).success).toBe(true);
  });

  test("accepts a populated events array", () => {
    expect(
      annotationEventListResponseSchema.safeParse({
        events: [baseUserEvent, { ...baseUserEvent, id: "00000000-0000-4000-8000-000000000011" }],
      }).success
    ).toBe(true);
  });
});
