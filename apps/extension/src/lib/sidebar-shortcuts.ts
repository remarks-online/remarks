import { isTypingEvent } from "./picker-guards";
import { type Dock, sidebarStore } from "./sidebar-store";

const DOCK_KEYS: Record<string, Dock> = {
  KeyR: "right",
  KeyL: "left",
  KeyB: "bottom",
};

export function registerSidebarShortcuts(): () => void {
  const handler = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;

    // Skip when the user is typing. The popover textarea lives in the sidebar
    // shadow root, so `event.target` retargets to the host — `isTypingEvent`
    // walks `composedPath()` to find the real input.
    if (isTypingEvent(event)) return;

    // ⌘⇧F / Ctrl+Shift+F — toggle sidebar visibility. No Alt; pairing Alt with
    // Shift on macOS produces glyphs in text fields, so reserve Alt-bearing
    // combos for the dock shortcuts below.
    if (!event.altKey && event.code === "KeyF") {
      event.preventDefault();
      sidebarStore.getState().toggleVisible();
      return;
    }

    // ⌘⇧⌥R / L / B (Ctrl+Shift+Alt+…) — set dock directly. Triple-modifier
    // dodges the ⌘⇧L/B/R browser bindings (downloads, bookmarks bar, hard
    // reload) and macOS screenshot combos (which use digits, not letters).
    if (event.altKey) {
      const dock = DOCK_KEYS[event.code];
      if (dock) {
        event.preventDefault();
        sidebarStore.getState().setDock(dock);
      }
    }
  };

  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}
