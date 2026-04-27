import { isTypingEvent } from "./picker-guards";
import { sidebarStore } from "./sidebar-store";

export function registerSidebarShortcuts(): () => void {
  const handler = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
    if (event.altKey) return;

    // Skip when the user is typing. The popover textarea lives in the sidebar
    // shadow root, so `event.target` retargets to the host — `isTypingEvent`
    // walks `composedPath()` to find the real input.
    if (isTypingEvent(event)) return;

    // ⌘⇧F / Ctrl+Shift+F — toggle sidebar visibility.
    if (event.code === "KeyF") {
      event.preventDefault();
      sidebarStore.getState().toggleVisible();
      return;
    }

    // ⌘⇧D / Ctrl+Shift+D — cycle dock.
    if (event.code === "KeyD") {
      event.preventDefault();
      sidebarStore.getState().cycleDock();
    }
  };

  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}
