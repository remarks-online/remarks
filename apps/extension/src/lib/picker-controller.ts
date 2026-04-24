import { buildDomContext } from "./dom-context";
import { elementAtPoint } from "./elements-at-point";
import { isInSidebarUi, isTypingTarget } from "./picker-guards";
import { type Capture, type HoveredPreview, type PickerState, pickerStore } from "./picker-store";
import { generateSelector } from "./selector-generator";

const OVERLAY_ID = "rmk-picker-overlay";
const LABEL_ID = "rmk-picker-label";
const BODY_ACTIVE_CLASS = "rmk-picker-active";
const Z_INDEX = 2147483646;

interface Session {
  abort: AbortController;
  overlay: HTMLDivElement;
  label: HTMLDivElement;
  hoveredElement: Element | null;
  pinnedParent: Element | null;
  resizeObserver: ResizeObserver | null;
  rafScheduled: boolean;
  lastPointer: { x: number; y: number } | null;
}

interface ControllerHandle {
  teardown: () => void;
}

function createOverlay(): HTMLDivElement {
  const el = document.createElement("div");
  el.id = OVERLAY_ID;
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = [
    "position: absolute",
    "pointer-events: none",
    "box-sizing: border-box",
    "border: 2px solid #3B82F6",
    "background: rgba(59, 130, 246, 0.1)",
    "border-radius: 4px",
    `z-index: ${Z_INDEX}`,
    "transition: transform 60ms ease-out, width 60ms ease-out, height 60ms ease-out",
    "transform: translate(-9999px, -9999px)",
    "width: 0",
    "height: 0",
    "top: 0",
    "left: 0",
    "will-change: transform, width, height",
  ].join(";");
  return el;
}

function createLabelChip(): HTMLDivElement {
  const el = document.createElement("div");
  el.id = LABEL_ID;
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = [
    "position: absolute",
    "pointer-events: none",
    "font-family: ui-monospace, SFMono-Regular, Menlo, monospace",
    "font-size: 11px",
    "line-height: 1",
    "padding: 4px 6px",
    "color: #ffffff",
    "background: #3B82F6",
    "border-radius: 3px",
    "white-space: nowrap",
    "box-shadow: 0 1px 2px rgba(15, 23, 42, 0.25)",
    `z-index: ${Z_INDEX}`,
    "transform: translate(-9999px, -9999px)",
    "top: 0",
    "left: 0",
    "max-width: 40vw",
    "overflow: hidden",
    "text-overflow: ellipsis",
  ].join(";");
  return el;
}

function formatLabelText(preview: HoveredPreview): string {
  const parts = [preview.tag.toUpperCase()];
  if (preview.classes[0]) parts.push(`.${preview.classes[0]}`);
  parts.push(`${Math.round(preview.dims.w)}×${Math.round(preview.dims.h)}`);
  return parts.join(" · ");
}

function previewFromElement(el: Element): HoveredPreview {
  const rect = el.getBoundingClientRect();
  const { selector, strategy } = generateSelector(el);
  const classes = Array.from(el.classList).filter(Boolean);
  const tag =
    el.namespaceURI === "http://www.w3.org/2000/svg" ? el.tagName : el.tagName.toLowerCase();
  return {
    selector,
    strategy,
    tag,
    classes,
    dims: { w: rect.width, h: rect.height },
  };
}

function buildCapture(el: Element, preview: HoveredPreview): Capture {
  const rect = el.getBoundingClientRect();
  return {
    selector: preview.selector,
    strategy: preview.strategy,
    domContext: buildDomContext(el),
    url: window.location.href,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
    },
    targetCoords: {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
    },
    capturedAt: Date.now(),
  };
}

function positionOverlay(session: Session, el: Element) {
  const rect = el.getBoundingClientRect();
  const x = rect.left + window.scrollX;
  const y = rect.top + window.scrollY;
  session.overlay.style.transform = `translate(${x}px, ${y}px)`;
  session.overlay.style.width = `${rect.width}px`;
  session.overlay.style.height = `${rect.height}px`;

  // Label chip: top-left, flip below if too close to viewport top.
  const labelRect = session.label.getBoundingClientRect();
  const labelHeight = labelRect.height || 20;
  const labelY = rect.top < labelHeight + 4 ? y + rect.height + 4 : y - labelHeight - 4;
  session.label.style.transform = `translate(${x}px, ${labelY}px)`;
}

function setHoveredElement(session: Session, el: Element | null, sidebarRoot: Node | null) {
  if (!el) {
    session.hoveredElement = null;
    session.overlay.style.transform = "translate(-9999px, -9999px)";
    session.label.style.transform = "translate(-9999px, -9999px)";
    pickerStore.getState().setHovered(null);
    if (session.resizeObserver) session.resizeObserver.disconnect();
    return;
  }

  // Skip hovers inside the sidebar shadow root.
  if (sidebarRoot && el.getRootNode() === sidebarRoot) {
    return;
  }

  session.hoveredElement = el;
  const preview = previewFromElement(el);
  session.label.textContent = formatLabelText(preview);
  positionOverlay(session, el);
  pickerStore.getState().setHovered(preview);

  if (session.resizeObserver) {
    session.resizeObserver.disconnect();
    if (el instanceof Element) {
      try {
        session.resizeObserver.observe(el);
      } catch {
        // SVG elements and detached nodes can't be observed; harmless.
      }
    }
  }
}

function startSession(sidebarRoot: Node | null): Session {
  const overlay = createOverlay();
  const label = createLabelChip();
  document.body.appendChild(overlay);
  document.body.appendChild(label);
  document.body.classList.add(BODY_ACTIVE_CLASS);

  const session: Session = {
    abort: new AbortController(),
    overlay,
    label,
    hoveredElement: null,
    pinnedParent: null,
    resizeObserver: null,
    rafScheduled: false,
    lastPointer: null,
  };

  if (typeof ResizeObserver !== "undefined") {
    session.resizeObserver = new ResizeObserver(() => {
      if (session.hoveredElement) positionOverlay(session, session.hoveredElement);
    });
  }

  const { signal } = session.abort;

  const scheduleReposition = () => {
    if (session.rafScheduled) return;
    session.rafScheduled = true;
    requestAnimationFrame(() => {
      session.rafScheduled = false;
      if (session.hoveredElement) positionOverlay(session, session.hoveredElement);
    });
  };

  const onMouseMove = (event: MouseEvent) => {
    session.lastPointer = { x: event.clientX, y: event.clientY };
    session.pinnedParent = null;
    if (session.rafScheduled) return;
    session.rafScheduled = true;
    requestAnimationFrame(() => {
      session.rafScheduled = false;
      if (!session.lastPointer) return;
      if (isInSidebarUi(event, sidebarRoot)) {
        setHoveredElement(session, null, sidebarRoot);
        return;
      }
      const hit = elementAtPoint(session.lastPointer.x, session.lastPointer.y);
      if (!hit) return;
      if (hit === session.overlay || hit === session.label) return;
      setHoveredElement(session, hit, sidebarRoot);
    });
  };

  const onClick = (event: MouseEvent) => {
    if (isInSidebarUi(event, sidebarRoot)) return;
    event.preventDefault();
    event.stopPropagation();
    const target = session.hoveredElement;
    if (!target) return;
    const preview = previewFromElement(target);
    const capture = buildCapture(target, preview);
    pickerStore.getState().commit(capture);
  };

  const stepToParent = () => {
    const current = session.pinnedParent ?? session.hoveredElement;
    if (!current) return;
    const parent = current.parentElement;
    if (!parent || parent === document.body) return;
    session.pinnedParent = parent;
    setHoveredElement(session, parent, sidebarRoot);
  };

  const stepToChild = () => {
    if (!session.lastPointer || !session.pinnedParent) return;
    const hit = elementAtPoint(session.lastPointer.x, session.lastPointer.y);
    if (!hit) return;
    session.pinnedParent = null;
    setHoveredElement(session, hit, sidebarRoot);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      pickerStore.getState().cancel();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      stepToParent();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      stepToChild();
    }
  };

  window.addEventListener("mousemove", onMouseMove, { passive: true, signal });
  window.addEventListener("click", onClick, { capture: true, signal });
  window.addEventListener("keydown", onKeyDown, { signal });
  window.addEventListener("scroll", scheduleReposition, { passive: true, signal });
  window.addEventListener("resize", scheduleReposition, { passive: true, signal });

  return session;
}

function endSession(session: Session) {
  session.abort.abort();
  session.overlay.remove();
  session.label.remove();
  session.resizeObserver?.disconnect();
  document.body.classList.remove(BODY_ACTIVE_CLASS);
}

export function initPickerController({
  sidebarRoot,
}: {
  sidebarRoot: Node | null;
}): ControllerHandle {
  let session: Session | null = null;
  let torn = false;

  const handleModeChange = (mode: PickerState["mode"]) => {
    if (mode === "element" && !session) {
      session = startSession(sidebarRoot);
    } else if (mode !== "element" && session) {
      endSession(session);
      session = null;
    }
  };

  // Global activator: listens for "C" regardless of mode.
  const onGlobalKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "c" && event.key !== "C") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTypingTarget(document.activeElement)) return;
    if (pickerStore.getState().mode !== "idle") return;
    event.preventDefault();
    pickerStore.getState().enterElementMode();
  };

  window.addEventListener("keydown", onGlobalKeyDown);

  const unsubscribe = pickerStore.subscribe((state, prev) => {
    if (state.mode !== prev.mode) handleModeChange(state.mode);
  });

  // Enter session if we're already in element mode on mount.
  handleModeChange(pickerStore.getState().mode);

  const teardown = () => {
    if (torn) return;
    torn = true;
    window.removeEventListener("keydown", onGlobalKeyDown);
    unsubscribe();
    if (session) {
      endSession(session);
      session = null;
    }
  };

  return { teardown };
}
