const TYPING_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);

export function isInSidebarUi(event: Event, sidebarRoot: Node | null): boolean {
  if (!sidebarRoot) return false;
  const path = event.composedPath();
  if (path.includes(sidebarRoot)) return true;
  if (sidebarRoot instanceof ShadowRoot && path.includes(sidebarRoot.host)) return true;
  return false;
}

export function isTypingTarget(node: EventTarget | Node | null | undefined): boolean {
  if (!node) return false;
  if (!(node instanceof Element)) return false;

  const tag = node.tagName;
  if (tag === "INPUT") {
    const type = (node as HTMLInputElement).type.toLowerCase();
    // Exclude pure-widget inputs where a keystroke like "c" is not text entry.
    const nonText = new Set([
      "button",
      "submit",
      "reset",
      "checkbox",
      "radio",
      "file",
      "image",
      "color",
      "range",
    ]);
    return !nonText.has(type);
  }
  if (tag === "TEXTAREA" || tag === "SELECT") return true;

  if ((node as HTMLElement).isContentEditable) return true;
  const editable = node.getAttribute("contenteditable");
  if (editable && editable !== "false") return true;

  const role = node.getAttribute("role")?.toLowerCase();
  if (role && TYPING_ROLES.has(role)) return true;

  return false;
}
