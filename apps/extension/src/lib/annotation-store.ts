import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export interface AnnotationUiState {
  // Set by either the pin layer (mouse over a pin) or the side panel thread
  // list (mouse over a row). Both sides read it to highlight the matching peer.
  hoveredAnnotationId: string | null;
  // Set when the user clicks a pin; the in-page edit popover opens against it.
  selectedAnnotationId: string | null;
  setHovered: (id: string | null) => void;
  setSelected: (id: string | null) => void;
}

export const annotationStore = createStore<AnnotationUiState>((set) => ({
  hoveredAnnotationId: null,
  selectedAnnotationId: null,
  setHovered: (id) => set({ hoveredAnnotationId: id }),
  setSelected: (id) => set({ selectedAnnotationId: id }),
}));

export function useAnnotationUi<T>(selector: (state: AnnotationUiState) => T): T {
  return useStore(annotationStore, selector);
}
