import type { AnnotationIntent, AnnotationSeverity } from "@remarks/shared";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export type Dock = "right" | "left" | "bottom";
export type Theme = "auto" | "light" | "dark";
export type StatusFilter = "to_do" | "doing" | "done" | "rejected" | "acknowledged" | "all";
export type IntentFilter = AnnotationIntent | "all";
export type SeverityFilter = AnnotationSeverity | "all";

export const WIDTH_MIN = 320;
export const WIDTH_MAX = 520;
export const HEIGHT_MIN = 200;
export const HEIGHT_MAX = 600;

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

export interface PersistedSidebarPrefs {
  visible: boolean;
  dock: Dock;
  width: number;
  height: number;
  theme: Theme;
  showHoverStyles: boolean;
}

export interface SidebarState extends PersistedSidebarPrefs {
  // In-memory only; not persisted across sessions.
  statusFilter: StatusFilter;
  intentFilter: IntentFilter;
  severityFilter: SeverityFilter;
  draftComment: string;
  draftIntent: AnnotationIntent | null;
  draftSeverity: AnnotationSeverity | null;
  setVisible: (visible: boolean) => void;
  toggleVisible: () => void;
  setDock: (dock: Dock) => void;
  setWidth: (width: number) => void;
  setHeight: (height: number) => void;
  setTheme: (theme: Theme) => void;
  setShowHoverStyles: (show: boolean) => void;
  setStatusFilter: (filter: StatusFilter) => void;
  setIntentFilter: (filter: IntentFilter) => void;
  setSeverityFilter: (filter: SeverityFilter) => void;
  setDraftComment: (text: string) => void;
  setDraftIntent: (value: AnnotationIntent | null) => void;
  setDraftSeverity: (value: AnnotationSeverity | null) => void;
  hydrate: (prefs: PersistedSidebarPrefs) => void;
  reset: () => void;
}

export const SIDEBAR_DEFAULTS: PersistedSidebarPrefs = {
  visible: true,
  dock: "right",
  width: 360,
  height: 280,
  theme: "auto",
  showHoverStyles: false,
};

export const sidebarStore = createStore<SidebarState>((set, get) => ({
  ...SIDEBAR_DEFAULTS,
  statusFilter: "all",
  intentFilter: "all",
  severityFilter: "all",
  draftComment: "",
  draftIntent: null,
  draftSeverity: null,
  setVisible: (visible) => set({ visible }),
  toggleVisible: () => set({ visible: !get().visible }),
  setDock: (dock) => set({ dock }),
  setWidth: (width) => set({ width: clampWidth(width) }),
  setHeight: (height) => set({ height: clampHeight(height) }),
  setTheme: (theme) => set({ theme }),
  setShowHoverStyles: (showHoverStyles) => set({ showHoverStyles }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  setIntentFilter: (intentFilter) => set({ intentFilter }),
  setSeverityFilter: (severityFilter) => set({ severityFilter }),
  setDraftComment: (draftComment) => set({ draftComment }),
  setDraftIntent: (draftIntent) => set({ draftIntent }),
  setDraftSeverity: (draftSeverity) => set({ draftSeverity }),
  hydrate: (prefs) =>
    set({
      visible: prefs.visible,
      dock: prefs.dock,
      width: clampWidth(prefs.width),
      height: clampHeight(prefs.height),
      theme: prefs.theme,
      showHoverStyles: prefs.showHoverStyles ?? SIDEBAR_DEFAULTS.showHoverStyles,
    }),
  reset: () =>
    set({
      ...SIDEBAR_DEFAULTS,
      statusFilter: "all",
      intentFilter: "all",
      severityFilter: "all",
      draftComment: "",
      draftIntent: null,
      draftSeverity: null,
    }),
}));

export function useSidebar<T>(selector: (state: SidebarState) => T): T {
  return useStore(sidebarStore, selector);
}

export function getPersistablePrefs(state: SidebarState): PersistedSidebarPrefs {
  return {
    visible: state.visible,
    dock: state.dock,
    width: state.width,
    height: state.height,
    theme: state.theme,
    showHoverStyles: state.showHoverStyles,
  };
}
