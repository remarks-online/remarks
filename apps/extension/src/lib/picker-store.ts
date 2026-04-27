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

export interface CaptureScreenshot {
  dataUrl: string;
  width: number;
  height: number;
}

interface CaptureBase {
  url: string;
  viewport: { width: number; height: number; dpr: number };
  // Scroll offset at commit time. Used to translate document-coord bounds back
  // to viewport coords for the cropped screenshot (see lib/screenshot.ts).
  scroll: { x: number; y: number };
  capturedAt: number;
  screenshot?: CaptureScreenshot;
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
  // True when the user pressed Esc on the capture popover. The capture itself
  // is preserved (so accidental Esc doesn't lose typed work) — the sidebar's
  // capture panel exposes a Resume affordance that flips this back to false.
  popoverDismissed: boolean;
  enterElementMode: () => void;
  enterRectMode: () => void;
  cancel: () => void;
  setHovered: (preview: HoveredPreview | null) => void;
  commit: (capture: Capture) => void;
  setScreenshot: (screenshot: CaptureScreenshot | null) => void;
  clearCapture: () => void;
  dismissPopover: () => void;
  resumePopover: () => void;
}

export const pickerStore = createStore<PickerState>((set) => ({
  mode: "idle",
  hovered: null,
  capture: null,
  popoverDismissed: false,
  enterElementMode: () =>
    set({ mode: "element", hovered: null, capture: null, popoverDismissed: false }),
  enterRectMode: () => set({ mode: "rect", hovered: null, capture: null, popoverDismissed: false }),
  cancel: () => set({ mode: "idle", hovered: null }),
  setHovered: (preview) => set({ hovered: preview }),
  commit: (capture) => set({ mode: "idle", hovered: null, capture, popoverDismissed: false }),
  setScreenshot: (screenshot) =>
    set((state) => {
      if (!state.capture) return {};
      if (screenshot) {
        return { capture: { ...state.capture, screenshot } };
      }
      const { screenshot: _discard, ...rest } = state.capture;
      return { capture: rest as Capture };
    }),
  clearCapture: () => set({ capture: null, popoverDismissed: false }),
  dismissPopover: () => set({ popoverDismissed: true }),
  resumePopover: () => set({ popoverDismissed: false }),
}));

export function usePicker<T>(selector: (state: PickerState) => T): T {
  return useStore(pickerStore, selector);
}
