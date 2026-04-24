import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export type Dock = "right" | "left" | "bottom";
export type Theme = "auto" | "light" | "dark";
export type StatusFilter = "to_do" | "doing" | "done" | "rejected" | "all";

export const WIDTH_MIN = 320;
export const WIDTH_MAX = 520;
export const HEIGHT_MIN = 200;
export const HEIGHT_MAX = 600;
export const DOCK_CYCLE: readonly Dock[] = ["right", "left", "bottom"] as const;

export function clampWidth(value: number): number {
  const rounded = Math.round(value);
  if (rounded < WIDTH_MIN) return WIDTH_MIN;
  if (rounded > WIDTH_MAX) return WIDTH_MAX;
  return rounded;
}

export function clampHeight(value: number): number {
  const rounded = Math.round(value);
  if (rounded < HEIGHT_MIN) return HEIGHT_MIN;
  if (rounded > HEIGHT_MAX) return HEIGHT_MAX;
  return rounded;
}

export function nextDock(current: Dock): Dock {
  const idx = DOCK_CYCLE.indexOf(current);
  // biome-ignore lint/style/noNonNullAssertion: DOCK_CYCLE is non-empty and idx wraps via modulo.
  return DOCK_CYCLE[(idx + 1) % DOCK_CYCLE.length]!;
}

export interface PersistedSidebarPrefs {
  visible: boolean;
  dock: Dock;
  compact: boolean;
  width: number;
  height: number;
  theme: Theme;
}

export interface SidebarState extends PersistedSidebarPrefs {
  // In-memory only; not persisted across sessions.
  statusFilter: StatusFilter;
  draftComment: string;
  setVisible: (visible: boolean) => void;
  toggleVisible: () => void;
  setDock: (dock: Dock) => void;
  cycleDock: () => void;
  setCompact: (compact: boolean) => void;
  setWidth: (width: number) => void;
  setHeight: (height: number) => void;
  setTheme: (theme: Theme) => void;
  setStatusFilter: (filter: StatusFilter) => void;
  setDraftComment: (text: string) => void;
  hydrate: (prefs: PersistedSidebarPrefs) => void;
  reset: () => void;
}

export const SIDEBAR_DEFAULTS: PersistedSidebarPrefs = {
  visible: true,
  dock: "right",
  compact: false,
  width: 360,
  height: 280,
  theme: "auto",
};

export const sidebarStore = createStore<SidebarState>((set, get) => ({
  ...SIDEBAR_DEFAULTS,
  statusFilter: "all",
  draftComment: "",
  setVisible: (visible) => set({ visible }),
  toggleVisible: () => set({ visible: !get().visible }),
  setDock: (dock) => set({ dock }),
  cycleDock: () => set({ dock: nextDock(get().dock) }),
  setCompact: (compact) => set({ compact }),
  setWidth: (width) => set({ width: clampWidth(width) }),
  setHeight: (height) => set({ height: clampHeight(height) }),
  setTheme: (theme) => set({ theme }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  setDraftComment: (draftComment) => set({ draftComment }),
  hydrate: (prefs) =>
    set({
      visible: prefs.visible,
      dock: prefs.dock,
      compact: prefs.compact,
      width: clampWidth(prefs.width),
      height: clampHeight(prefs.height),
      theme: prefs.theme,
    }),
  reset: () =>
    set({
      ...SIDEBAR_DEFAULTS,
      statusFilter: "all",
      draftComment: "",
    }),
}));

export function useSidebar<T>(selector: (state: SidebarState) => T): T {
  return useStore(sidebarStore, selector);
}

export function getPersistablePrefs(state: SidebarState): PersistedSidebarPrefs {
  return {
    visible: state.visible,
    dock: state.dock,
    compact: state.compact,
    width: state.width,
    height: state.height,
    theme: state.theme,
  };
}
