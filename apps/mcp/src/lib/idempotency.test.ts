import { describe, expect, it, vi } from "vitest";
import { createRedisIdempotencyCache, hashPayload } from "./idempotency.js";

// Minimal stand-in for the Upstash Redis surface our cache uses. The real
// client serializes objects as JSON; the fake just stores the value verbatim
// so we can assert on the cached entry shape.
function makeFakeRedis(): {
  store: Map<string, unknown>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, unknown>();
  const get = vi.fn(async (key: string) => store.get(key) ?? null);
  const set = vi.fn(async (key: string, value: unknown) => {
    store.set(key, value);
    return "OK";
  });
  return { store, get, set };
}

function makeCache(): {
  cache: ReturnType<typeof createRedisIdempotencyCache>;
  redis: ReturnType<typeof makeFakeRedis>;
} {
  const redis = makeFakeRedis();
  const cache = createRedisIdempotencyCache(
    redis as unknown as Parameters<typeof createRedisIdempotencyCache>[0]
  );
  return { cache, redis };
}

describe("hashPayload", () => {
  it("is stable across key insertion order", () => {
    const a = hashPayload({ a: 1, b: 2, c: { d: 3, e: 4 } });
    const b = hashPayload({ c: { e: 4, d: 3 }, b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it("preserves array element order (positional meaning)", () => {
    const a = hashPayload([{ x: 1 }, { x: 2 }]);
    const b = hashPayload([{ x: 2 }, { x: 1 }]);
    expect(a).not.toBe(b);
  });

  it("distinguishes absent vs explicit-undefined fields by JSON semantics", () => {
    // JSON.stringify drops `undefined` values, so { kind: undefined } and {}
    // hash equally — that's the standard wire-level equivalence the spec
    // operates over (Zod also drops undefined after parsing optionals). Lock
    // this in so future refactors don't accidentally diverge.
    const a = hashPayload({ kind: undefined, comment: "x" });
    const b = hashPayload({ comment: "x" });
    expect(a).toBe(b);
  });
});

describe("createRedisIdempotencyCache", () => {
  it("returns miss on first call, hit on replay with the same payload", async () => {
    const { cache } = makeCache();
    const args = {
      tool: "remarks_update_task_status" as const,
      tokenId: "11111111-1111-4111-8111-111111111111",
      key: "22222222-2222-4222-8222-222222222222",
      payload: { task_id: "abc", status: "done" },
    };

    const first = await cache.check<{ ok: boolean }>(args);
    expect(first).toEqual({ kind: "miss" });

    await cache.store({ ...args, response: { ok: true } });

    const second = await cache.check<{ ok: boolean }>(args);
    expect(second).toEqual({ kind: "hit", response: { ok: true } });
  });

  it("returns conflict when the same key is replayed with a different payload", async () => {
    const { cache } = makeCache();
    const base = {
      tool: "remarks_update_task_status" as const,
      tokenId: "11111111-1111-4111-8111-111111111111",
      key: "22222222-2222-4222-8222-222222222222",
    };

    await cache.store({
      ...base,
      payload: { task_id: "abc", status: "done" },
      response: { ok: true },
    });

    const conflicting = await cache.check({
      ...base,
      payload: { task_id: "abc", status: "rejected" },
    });
    expect(conflicting).toEqual({ kind: "conflict" });
  });

  it("scopes keys by tokenId so two tokens don't collide", async () => {
    const { cache, redis } = makeCache();
    const shared = {
      tool: "remarks_update_task_status" as const,
      key: "22222222-2222-4222-8222-222222222222",
      payload: { task_id: "abc", status: "done" },
    };

    await cache.store({
      ...shared,
      tokenId: "token-a",
      response: { tag: "a" },
    });
    await cache.store({
      ...shared,
      tokenId: "token-b",
      response: { tag: "b" },
    });

    expect(redis.store.size).toBe(2);
    expect(await cache.check<{ tag: string }>({ ...shared, tokenId: "token-a" })).toEqual({
      kind: "hit",
      response: { tag: "a" },
    });
    expect(await cache.check<{ tag: string }>({ ...shared, tokenId: "token-b" })).toEqual({
      kind: "hit",
      response: { tag: "b" },
    });
  });

  it("writes with a 24h TTL", async () => {
    const { cache, redis } = makeCache();
    await cache.store({
      tool: "remarks_update_task_status" as const,
      tokenId: "tk",
      key: "k",
      payload: { x: 1 },
      response: { ok: true },
    });
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining("idempotency:remarks_update_task_status:tk:k"),
      expect.any(Object),
      { ex: 60 * 60 * 24 }
    );
  });
});
