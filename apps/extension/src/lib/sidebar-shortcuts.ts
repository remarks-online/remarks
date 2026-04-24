import { isTypingTarget } from "./picker-guards";
import { sidebarStore } from "./sidebar-store";

interface Options {
  onFocusCompose?: () => void;
}

export function registerSidebarShortcuts(options: Options = {}): () => void {
  const handler = (event: KeyboardEvent) => {
    const keyLower = event.key.toLowerCase();

    // Cmd/Ctrl + Shift + F — toggle sidebar visibility.
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && keyLower === "f") {
      event.preventDefault();
      sidebarStore.getState().toggleVisible();
      return;
    }

    // Cmd/Ctrl + Shift + D — cycle dock.
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && keyLower === "d") {
      event.preventDefault();
      sidebarStore.getState().cycleDock();
      return;
    }

    // Plain F — focus the compose textarea. Skip when typing anywhere.
    if (!event.metaKey && !event.ctrlKey && !event.altKey && keyLower === "f") {
      const target = event.target instanceof Element ? event.target : document.activeElement;
      if (isTypingTarget(target)) return;
      event.preventDefault();
      options.onFocusCompose?.();
    }
  };

  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}
