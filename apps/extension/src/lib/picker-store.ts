import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { DomContext } from "./dom-context";
import type { SelectorStrategy } from "./selector-generator";

export type PickerMode = "idle" | "element" | "rect";

export interface HoveredPreview {
  selector: string;
  strategy: SelectorStrategy;
  tag: string;
  classes: string[];
  dims: { w: number; h: number };
}

interface CaptureBase {
  url: string;
  viewport: { width: number; height: number; dpr: number };
  capturedAt: number;
}

export interface ElementCapture extends CaptureBase {
  kind: "element";
  selector: string;
  strategy: SelectorStrategy;
  domContext: DomContext;
  // Document-coordinate bounds of the picked element at capture time.
  targetCoords: { x: number; y: number; width: number; height: number };
}

export interface RectCapture extends CaptureBase {
  kind: "rect";
  // Document coordinates so the rect survives scroll (spec §6.6).
  rect: { x: number; y: number; width: number; height: number };
}

export type Capture = ElementCapture | RectCapture;

export interface PickerState {
  mode: PickerMode;
  hovered: HoveredPreview | null;
  capture: Capture | null;
  enterElementMode: () => void;
  enterRectMode: () => void;
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
  enterRectMode: () => set({ mode: "rect", hovered: null, capture: null }),
  cancel: () => set({ mode: "idle", hovered: null }),
  setHovered: (preview) => set({ hovered: preview }),
  commit: (capture) => set({ mode: "idle", hovered: null, capture }),
  clearCapture: () => set({ capture: null }),
}));

export function usePicker<T>(selector: (state: PickerState) => T): T {
  return useStore(pickerStore, selector);
}
