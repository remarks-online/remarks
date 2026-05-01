import { describe, expect, test } from "vitest";
import {
  annotationStreamEventSchema,
  buildStreamEventId,
  parseStreamEventId,
} from "./annotation-stream.js";

const VALID_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("buildStreamEventId / parseStreamEventId", () => {
  test("round-trips an iso-timestamp + uuid", () => {
    const ts = new Date("2026-04-30T12:34:56.789Z");
    const id = buildStreamEventId(ts, VALID_UUID);
    const parsed = parseStreamEventId(id);
    expect(parsed).not.toBeNull();
    expect(parsed?.eventId).toBe(VALID_UUID);
    expect(parsed?.createdAt.toISOString()).toBe(ts.toISOString());
  });

  test("rejects malformed ids", () => {
    expect(parseStreamEventId("")).toBeNull();
    expect(parseStreamEventId("not-an-id")).toBeNull();
    expect(parseStreamEventId(`${VALID_UUID}`)).toBeNull(); // no separator
    expect(parseStreamEventId("not-a-date:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBeNull();
    expect(parseStreamEventId("2026-04-30T00:00:00.000Z:not-a-uuid")).toBeNull();
  });

  test("ids sort lexicographically by (createdAt, uuid)", () => {
    const t1 = new Date("2026-04-30T00:00:00.000Z");
    const t2 = new Date("2026-04-30T00:00:01.000Z");
    const a = buildStreamEventId(t1, VALID_UUID);
    const b = buildStreamEventId(t1, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    const c = buildStreamEventId(t2, VALID_UUID);
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
  });
});

describe("annotationStreamEventSchema", () => {
  test("accepts a well-formed envelope", () => {
    const result = annotationStreamEventSchema.safeParse({
      id: "2026-04-30T12:34:56.789Z:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      type: "created",
      annotationId: "11111111-1111-4111-8111-111111111111",
      projectId: null,
      authorId: "22222222-2222-4222-8222-222222222222",
      actorType: "user",
      actorId: "22222222-2222-4222-8222-222222222222",
      actorOauthClientId: null,
      payload: {},
      createdAt: "2026-04-30T12:34:56.789Z",
    });
    expect(result.success).toBe(true);
  });

  test("rejects an unknown event type", () => {
    const result = annotationStreamEventSchema.safeParse({
      id: "2026-04-30T12:34:56.789Z:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      type: "totally-bogus",
      annotationId: "11111111-1111-4111-8111-111111111111",
      projectId: null,
      authorId: "22222222-2222-4222-8222-222222222222",
      actorType: "user",
      actorId: "22222222-2222-4222-8222-222222222222",
      actorOauthClientId: null,
      payload: {},
      createdAt: "2026-04-30T12:34:56.789Z",
    });
    expect(result.success).toBe(false);
  });
});
