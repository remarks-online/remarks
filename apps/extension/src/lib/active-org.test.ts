import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type WatchCb<T> = (next: T | null) => void;

const fake = (() => {
  const map = new Map<string, unknown>();
  const watchers = new Map<string, Set<WatchCb<unknown>>>();
  return {
    async getItem<T>(key: string) {
      return (map.get(key) as T | undefined) ?? null;
    },
    async setItem<T>(key: string, value: T) {
      map.set(key, value);
      const ws = watchers.get(key);
      if (ws) for (const cb of ws) cb(value as unknown as null);
    },
    async removeItem(key: string) {
      map.delete(key);
      const ws = watchers.get(key);
      if (ws) for (const cb of ws) cb(null);
    },
    watch<T>(key: string, cb: WatchCb<T>) {
      let set = watchers.get(key);
      if (!set) {
        set = new Set();
        watchers.set(key, set);
      }
      set.add(cb as WatchCb<unknown>);
      return () => set?.delete(cb as WatchCb<unknown>);
    },
    __reset() {
      map.clear();
      watchers.clear();
    },
  };
})();

vi.mock("wxt/utils/storage", () => ({ storage: fake }));

beforeEach(() => {
  fake.__reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("active-org", () => {
  it("getActiveClerkOrgId returns null when unset", async () => {
    const { getActiveClerkOrgId } = await import("./active-org");
    expect(await getActiveClerkOrgId()).toBeNull();
  });

  it("set / get round-trips", async () => {
    const { setActiveClerkOrgId, getActiveClerkOrgId } = await import("./active-org");
    await setActiveClerkOrgId("org_abc");
    expect(await getActiveClerkOrgId()).toBe("org_abc");
  });

  it("setActiveClerkOrgId(null) clears the key", async () => {
    const { setActiveClerkOrgId, getActiveClerkOrgId } = await import("./active-org");
    await setActiveClerkOrgId("org_abc");
    await setActiveClerkOrgId(null);
    expect(await getActiveClerkOrgId()).toBeNull();
  });

  it("watchActiveClerkOrgId fires on write and clear", async () => {
    const { setActiveClerkOrgId, watchActiveClerkOrgId } = await import("./active-org");
    const calls: (string | null)[] = [];
    const unwatch = watchActiveClerkOrgId((id) => calls.push(id));
    await setActiveClerkOrgId("org_abc");
    await setActiveClerkOrgId(null);
    expect(calls).toEqual(["org_abc", null]);
    unwatch();
  });
});
