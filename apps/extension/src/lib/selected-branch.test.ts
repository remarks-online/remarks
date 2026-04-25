import { MAX_BRANCH_NAME_LENGTH } from "@remarks/shared";
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

const PROJECT_A = "11111111-1111-1111-1111-111111111111";
const PROJECT_B = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  fake.__reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("selected-branch", () => {
  it("getSelectedBranch returns DEFAULT_BRANCH when nothing is stored", async () => {
    const { getSelectedBranch, DEFAULT_BRANCH } = await import("./selected-branch");
    expect(await getSelectedBranch(PROJECT_A)).toBe(DEFAULT_BRANCH);
    expect(DEFAULT_BRANCH).toBe("main");
  });

  it("set / get round-trips a normal branch name", async () => {
    const { setSelectedBranch, getSelectedBranch } = await import("./selected-branch");
    await setSelectedBranch(PROJECT_A, "feat/foo");
    expect(await getSelectedBranch(PROJECT_A)).toBe("feat/foo");
  });

  it("trims surrounding whitespace on write", async () => {
    const { setSelectedBranch, getSelectedBranch } = await import("./selected-branch");
    await setSelectedBranch(PROJECT_A, "  release/1.2  ");
    expect(await getSelectedBranch(PROJECT_A)).toBe("release/1.2");
  });

  it("falls back to DEFAULT_BRANCH when set with empty / whitespace", async () => {
    const { setSelectedBranch, getSelectedBranch, DEFAULT_BRANCH } = await import(
      "./selected-branch"
    );
    await setSelectedBranch(PROJECT_A, "feat/foo");
    await setSelectedBranch(PROJECT_A, "   ");
    expect(await getSelectedBranch(PROJECT_A)).toBe(DEFAULT_BRANCH);
  });

  it("clamps writes to MAX_BRANCH_NAME_LENGTH", async () => {
    const { setSelectedBranch, getSelectedBranch } = await import("./selected-branch");
    const overflow = "a".repeat(MAX_BRANCH_NAME_LENGTH + 50);
    await setSelectedBranch(PROJECT_A, overflow);
    const stored = await getSelectedBranch(PROJECT_A);
    expect(stored).toHaveLength(MAX_BRANCH_NAME_LENGTH);
  });

  it("isolates branches by projectId", async () => {
    const { setSelectedBranch, getSelectedBranch, DEFAULT_BRANCH } = await import(
      "./selected-branch"
    );
    await setSelectedBranch(PROJECT_A, "feat/a");
    expect(await getSelectedBranch(PROJECT_B)).toBe(DEFAULT_BRANCH);
    await setSelectedBranch(PROJECT_B, "feat/b");
    expect(await getSelectedBranch(PROJECT_A)).toBe("feat/a");
    expect(await getSelectedBranch(PROJECT_B)).toBe("feat/b");
  });

  it("watchSelectedBranch fires with normalized values", async () => {
    const { setSelectedBranch, watchSelectedBranch, DEFAULT_BRANCH } = await import(
      "./selected-branch"
    );
    const calls: string[] = [];
    const unwatch = watchSelectedBranch(PROJECT_A, (b) => calls.push(b));
    await setSelectedBranch(PROJECT_A, "  feat/x  ");
    await setSelectedBranch(PROJECT_A, "");
    expect(calls).toEqual(["feat/x", DEFAULT_BRANCH]);
    unwatch();
  });
});
