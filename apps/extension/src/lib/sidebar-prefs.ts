import { storage } from "wxt/utils/storage";
import type { PersistedSidebarPrefs } from "./sidebar-store";

const SIDEBAR_PREFS_KEY = "sync:remarks.sidebar.prefs" as const;
export const SIDEBAR_PREFS_DEBOUNCE_MS = 250;

export function loadSidebarPrefs(): Promise<PersistedSidebarPrefs | null> {
  return storage.getItem<PersistedSidebarPrefs>(SIDEBAR_PREFS_KEY);
}

let pending: PersistedSidebarPrefs | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function saveSidebarPrefs(prefs: PersistedSidebarPrefs): void {
  pending = prefs;
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    const snapshot = pending;
    pending = null;
    if (!snapshot) return;
    void storage.setItem(SIDEBAR_PREFS_KEY, snapshot);
  }, SIDEBAR_PREFS_DEBOUNCE_MS);
}

export function watchSidebarPrefs(cb: (prefs: PersistedSidebarPrefs | null) => void): () => void {
  return storage.watch<PersistedSidebarPrefs>(SIDEBAR_PREFS_KEY, (value) => cb(value));
}
