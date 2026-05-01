import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type WatchCb<T> = (next: T | null) => void;

interface FakeStorage {
  getItem<T>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<void>;
  watch<T>(key: string, cb: WatchCb<T>): () => void;
  __reset(): void;
  __emit<T>(key: string, value: T | null): void;
}

const fake: FakeStorage = (() => {
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
    __emit<T>(key: string, value: T | null) {
      const ws = watchers.get(key);
      if (ws) for (const cb of ws) cb(value as unknown as null);
    },
  };
})();

vi.mock("wxt/utils/storage", () => ({
  storage: fake,
}));

beforeEach(() => {
  fake.__reset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sidebar-prefs", () => {
  it("loadSidebarPrefs returns null when nothing is persisted", async () => {
    const { loadSidebarPrefs } = await import("./sidebar-prefs");
    const prefs = await loadSidebarPrefs();
    expect(prefs).toBeNull();
  });

  it("saveSidebarPrefs debounces writes and eventually persists", async () => {
    const { saveSidebarPrefs, loadSidebarPrefs, SIDEBAR_PREFS_DEBOUNCE_MS } = await import(
      "./sidebar-prefs"
    );

    saveSidebarPrefs({
      visible: true,
      dock: "right",
      width: 320,
      height: 240,
      theme: "auto",
      showHoverStyles: false,
    });
    saveSidebarPrefs({
      visible: true,
      dock: "left",
      width: 360,
      height: 240,
      theme: "auto",
      showHoverStyles: true,
    });

    // Before debounce elapses, nothing is written.
    await vi.advanceTimersByTimeAsync(SIDEBAR_PREFS_DEBOUNCE_MS - 10);
    expect(await loadSidebarPrefs()).toBeNull();

    await vi.advanceTimersByTimeAsync(20);
    const prefs = await loadSidebarPrefs();
    // Last call wins.
    expect(prefs?.dock).toBe("left");
    expect(prefs?.width).toBe(360);
    expect(prefs?.showHoverStyles).toBe(true);
  });

  it("watchSidebarPrefs fires when the persisted value changes", async () => {
    const { watchSidebarPrefs, saveSidebarPrefs, SIDEBAR_PREFS_DEBOUNCE_MS } = await import(
      "./sidebar-prefs"
    );

    const calls: unknown[] = [];
    const unwatch = watchSidebarPrefs((next) => calls.push(next));

    saveSidebarPrefs({
      visible: false,
      dock: "bottom",
      width: 320,
      height: 280,
      theme: "dark",
      showHoverStyles: false,
    });
    await vi.advanceTimersByTimeAsync(SIDEBAR_PREFS_DEBOUNCE_MS + 5);

    expect(calls).toHaveLength(1);
    unwatch();
  });
});
