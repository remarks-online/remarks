import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { DomContext } from "./dom-context";
import type { SelectorStrategy } from "./selector-generator";

export type PickerMode = "idle" | "element";

export interface HoveredPreview {
  selector: string;
  strategy: SelectorStrategy;
  tag: string;
  classes: string[];
  dims: { w: number; h: number };
}

export interface Capture {
  selector: string;
  strategy: SelectorStrategy;
  domContext: DomContext;
  url: string;
  viewport: { width: number; height: number; dpr: number };
  targetCoords: { x: number; y: number; width: number; height: number };
  capturedAt: number;
}

export interface PickerState {
  mode: PickerMode;
  hovered: HoveredPreview | null;
  capture: Capture | null;
  enterElementMode: () => void;
  cancel: () => void;
  setHovered: (preview: HoveredPreview | null) => void;
  commit: (capture: Capture) => void;
  clearCapture: () => void;
}

export const pickerStore = createStore<PickerState>((set) => ({
  mode: "idle",
  hovered: null,
  capture: null,
  enterElementMode: () => set({ mode: "element", hovered: null, capture: null }),
  cancel: () => set({ mode: "idle", hovered: null }),
  setHovered: (preview) => set({ hovered: preview }),
  commit: (capture) => set({ mode: "idle", hovered: null, capture }),
  clearCapture: () => set({ capture: null }),
}));

export function usePicker<T>(selector: (state: PickerState) => T): T {
  return useStore(pickerStore, selector);
}
