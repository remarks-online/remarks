import { buildDomContext, compactHoverStyles } from "./dom-context";
import { elementAtPoint } from "./elements-at-point";
import { requestReactComponents } from "./fiber-bridge";
import { isInSidebarUi, isTypingEvent } from "./picker-guards";
import {
  type Capture,
  type ElementCapture,
  type HoveredPreview,
  type PickerMode,
  type RectCapture,
  pickerStore,
} from "./picker-store";
import { requestScreenshot } from "./screenshot";
import { generateSelector } from "./selector-generator";
import { sidebarStore } from "./sidebar-store";

const ELEMENT_OVERLAY_ID = "rmk-picker-overlay";
const ELEMENT_LABEL_ID = "rmk-picker-label";
const ELEMENT_STYLES_ID = "rmk-picker-styles";
const ELEMENT_BODY_ACTIVE_CLASS = "rmk-picker-active";

const RECT_OVERLAY_ID = "rmk-rect-overlay";
const RECT_LABEL_ID = "rmk-rect-label";
const RECT_BODY_ACTIVE_CLASS = "rmk-rect-active";

const Z_INDEX = 2147483646;
const MIN_RECT_SIZE = 8;
const AUTO_SCROLL_EDGE = 40;
const AUTO_SCROLL_MAX_VELOCITY = 18;

/**
 * Pure helper exposed for unit testing: returns the per-frame scroll delta
 * (positive = scroll down) when the cursor sits inside the auto-scroll band.
 */
export function computeAutoScrollDelta(clientY: number, viewportHeight: number): number {
  if (clientY < AUTO_SCROLL_EDGE) {
    const intensity = (AUTO_SCROLL_EDGE - clientY) / AUTO_SCROLL_EDGE;
    return -Math.ceil(intensity * AUTO_SCROLL_MAX_VELOCITY);
  }
  if (clientY > viewportHeight - AUTO_SCROLL_EDGE) {
    const intensity = (clientY - (viewportHeight - AUTO_SCROLL_EDGE)) / AUTO_SCROLL_EDGE;
    return Math.ceil(intensity * AUTO_SCROLL_MAX_VELOCITY);
  }
  return 0;
}

interface ActiveSession {
  end: () => void;
}

interface ControllerHandle {
  teardown: () => void;
}

function createElementOverlay(): HTMLDivElement {
  const el = document.createElement("div");
  el.id = ELEMENT_OVERLAY_ID;
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

function createRectOverlay(): HTMLDivElement {
  const el = document.createElement("div");
  el.id = RECT_OVERLAY_ID;
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = [
    "position: absolute",
    "pointer-events: none",
    "box-sizing: border-box",
    "border: 2px dashed #F59E0B",
    "background: rgba(245, 158, 11, 0.12)",
    "border-radius: 2px",
    `z-index: ${Z_INDEX}`,
    "transform: translate(-9999px, -9999px)",
    "width: 0",
    "height: 0",
    "top: 0",
    "left: 0",
    "will-change: transform, width, height",
  ].join(";");
  return el;
}

function createLabelChip(id: string, background: string): HTMLDivElement {
  const el = document.createElement("div");
  el.id = id;
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = [
    "position: absolute",
    "pointer-events: none",
    "font-family: ui-monospace, SFMono-Regular, Menlo, monospace",
    "font-size: 11px",
    "line-height: 1",
    "padding: 4px 6px",
    "color: #ffffff",
    `background: ${background}`,
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

function createStylesTooltip(): HTMLDivElement {
  const el = document.createElement("div");
  el.id = ELEMENT_STYLES_ID;
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = [
    "position: absolute",
    "pointer-events: none",
    "font-family: ui-monospace, SFMono-Regular, Menlo, monospace",
    "font-size: 11px",
    "line-height: 1.35",
    "padding: 6px 8px",
    "color: #f8fafc",
    "background: rgba(15, 23, 42, 0.92)",
    "border-radius: 4px",
    "box-shadow: 0 4px 12px rgba(15, 23, 42, 0.35)",
    `z-index: ${Z_INDEX}`,
    "transform: translate(-9999px, -9999px)",
    "top: 0",
    "left: 0",
    "max-width: 260px",
    "white-space: normal",
    "word-break: break-word",
  ].join(";");
  return el;
}

function renderStylesTooltipContent(
  tooltip: HTMLDivElement,
  styles: Record<string, string> | undefined
): boolean {
  tooltip.replaceChildren();
  if (!styles) return false;
  const entries = Object.entries(styles);
  if (entries.length === 0) return false;
  const dl = document.createElement("dl");
  dl.style.cssText = [
    "margin: 0",
    "display: grid",
    "grid-template-columns: max-content 1fr",
    "gap: 2px 8px",
  ].join(";");
  for (const [key, value] of entries) {
    const dt = document.createElement("dt");
    dt.textContent = key;
    dt.style.cssText = "color: rgba(248, 250, 252, 0.6); margin: 0;";
    const dd = document.createElement("dd");
    dd.textContent = value;
    dd.style.cssText = "margin: 0; overflow-wrap: anywhere;";
    dl.appendChild(dt);
    dl.appendChild(dd);
  }
  tooltip.appendChild(dl);
  return true;
}

function formatElementLabelText(preview: HoveredPreview): string {
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

function buildElementCapture(el: Element, preview: HoveredPreview): ElementCapture {
  const rect = el.getBoundingClientRect();
  return {
    kind: "element",
    selector: preview.selector,
    strategy: preview.strategy,
    domContext: buildDomContext(el),
    url: window.location.href,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
    },
    scroll: { x: window.scrollX, y: window.scrollY },
    targetCoords: {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
    },
    capturedAt: Date.now(),
  };
}

/**
 * Wait one frame after `commit()` so the picker overlays (which get torn down
 * when mode flips to "idle") are gone before captureVisibleTab fires. Without
 * this the blue element outline or orange rect shows up in the screenshot.
 */
function scheduleScreenshot(capture: Capture) {
  requestAnimationFrame(() => {
    void requestScreenshot(capture);
  });
}

function startElementSession(sidebarRoot: Node | null): ActiveSession {
  const overlay = createElementOverlay();
  const label = createLabelChip(ELEMENT_LABEL_ID, "#3B82F6");
  const stylesTooltip = createStylesTooltip();
  document.body.appendChild(overlay);
  document.body.appendChild(label);
  document.body.appendChild(stylesTooltip);
  document.body.classList.add(ELEMENT_BODY_ACTIVE_CLASS);

  const abort = new AbortController();
  const { signal } = abort;

  let hoveredElement: Element | null = null;
  let pinnedParent: Element | null = null;
  let rafScheduled = false;
  let lastPointer: { x: number; y: number } | null = null;
  let stylesVisible = false;

  const resizeObserver =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          if (hoveredElement) positionOverlay(hoveredElement);
        })
      : null;

  const hideStylesTooltip = () => {
    stylesTooltip.style.transform = "translate(-9999px, -9999px)";
    stylesVisible = false;
  };

  const positionOverlay = (el: Element) => {
    const rect = el.getBoundingClientRect();
    const x = rect.left + window.scrollX;
    const y = rect.top + window.scrollY;
    overlay.style.transform = `translate(${x}px, ${y}px)`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;

    const labelRect = label.getBoundingClientRect();
    const labelHeight = labelRect.height || 20;
    const labelAbove = rect.top >= labelHeight + 4;
    const labelY = labelAbove ? y - labelHeight - 4 : y + rect.height + 4;
    label.style.transform = `translate(${x}px, ${labelY}px)`;

    if (!stylesVisible) return;
    const tooltipRect = stylesTooltip.getBoundingClientRect();
    const tooltipHeight = tooltipRect.height || 80;
    // Place the tooltip on the opposite side from the label when possible so
    // both element ID + computed styles stay visible without overlapping the
    // hovered region.
    const tooltipBelow = !labelAbove ? rect.bottom + tooltipHeight + 8 <= window.innerHeight : true;
    const tooltipY = tooltipBelow
      ? y + rect.height + 4
      : Math.max(y - tooltipHeight - 4, window.scrollY + 4);
    stylesTooltip.style.transform = `translate(${x}px, ${tooltipY}px)`;
  };

  const setHoveredElement = (el: Element | null) => {
    if (!el) {
      hoveredElement = null;
      overlay.style.transform = "translate(-9999px, -9999px)";
      label.style.transform = "translate(-9999px, -9999px)";
      hideStylesTooltip();
      pickerStore.getState().setHovered(null);
      resizeObserver?.disconnect();
      return;
    }
    if (sidebarRoot && el.getRootNode() === sidebarRoot) return;

    hoveredElement = el;
    const preview = previewFromElement(el);
    label.textContent = formatElementLabelText(preview);

    if (sidebarStore.getState().showHoverStyles) {
      stylesVisible = renderStylesTooltipContent(stylesTooltip, compactHoverStyles(el));
      if (!stylesVisible) hideStylesTooltip();
    } else {
      hideStylesTooltip();
    }

    positionOverlay(el);
    pickerStore.getState().setHovered(preview);

    if (resizeObserver) {
      resizeObserver.disconnect();
      try {
        resizeObserver.observe(el);
      } catch {
        // SVG elements and detached nodes can't be observed; harmless.
      }
    }
  };

  const scheduleReposition = () => {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      if (hoveredElement) positionOverlay(hoveredElement);
    });
  };

  const onMouseMove = (event: MouseEvent) => {
    lastPointer = { x: event.clientX, y: event.clientY };
    pinnedParent = null;
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      if (!lastPointer) return;
      if (isInSidebarUi(event, sidebarRoot)) {
        setHoveredElement(null);
        return;
      }
      const hit = elementAtPoint(lastPointer.x, lastPointer.y);
      if (!hit) return;
      if (hit === overlay || hit === label || hit === stylesTooltip) return;
      setHoveredElement(hit);
    });
  };

  const onClick = (event: MouseEvent) => {
    if (isInSidebarUi(event, sidebarRoot)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!hoveredElement) return;
    const preview = previewFromElement(hoveredElement);
    const capture = buildElementCapture(hoveredElement, preview);
    pickerStore.getState().commit(capture);
    scheduleScreenshot(capture);
    // G13: enrichment is fire-and-forget. The popover already renders the
    // sync domContext above; the React component chain lands ~tens of ms
    // later when the MAIN-world bridge replies, and the popover re-renders.
    void requestReactComponents(hoveredElement).then((result) => {
      if (!result) return;
      pickerStore.getState().attachReactInfo(result);
    });
  };

  const stepToParent = () => {
    const current = pinnedParent ?? hoveredElement;
    if (!current) return;
    const parent = current.parentElement;
    if (!parent || parent === document.body) return;
    pinnedParent = parent;
    setHoveredElement(parent);
  };

  const stepToChild = () => {
    if (!lastPointer || !pinnedParent) return;
    const hit = elementAtPoint(lastPointer.x, lastPointer.y);
    if (!hit) return;
    pinnedParent = null;
    setHoveredElement(hit);
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

  return {
    end: () => {
      abort.abort();
      overlay.remove();
      label.remove();
      stylesTooltip.remove();
      resizeObserver?.disconnect();
      document.body.classList.remove(ELEMENT_BODY_ACTIVE_CLASS);
    },
  };
}

function startRectSession(sidebarRoot: Node | null): ActiveSession {
  const overlay = createRectOverlay();
  const label = createLabelChip(RECT_LABEL_ID, "#F59E0B");
  document.body.appendChild(overlay);
  document.body.appendChild(label);
  document.body.classList.add(RECT_BODY_ACTIVE_CLASS);

  const abort = new AbortController();
  const { signal } = abort;

  let dragging = false;
  let startDoc: { x: number; y: number } | null = null;
  let lastPointer: { clientX: number; clientY: number } | null = null;
  let currentRect: { x: number; y: number; width: number; height: number } | null = null;
  let moveRafScheduled = false;
  let scrollRafId: number | null = null;

  const hideOverlay = () => {
    overlay.style.transform = "translate(-9999px, -9999px)";
    label.style.transform = "translate(-9999px, -9999px)";
  };

  const positionOverlay = () => {
    if (!currentRect) {
      hideOverlay();
      return;
    }
    overlay.style.transform = `translate(${currentRect.x}px, ${currentRect.y}px)`;
    overlay.style.width = `${currentRect.width}px`;
    overlay.style.height = `${currentRect.height}px`;
    label.textContent = `${Math.round(currentRect.width)} × ${Math.round(currentRect.height)}`;
    const labelX = currentRect.x + currentRect.width + 4;
    const labelY = currentRect.y + currentRect.height + 4;
    label.style.transform = `translate(${labelX}px, ${labelY}px)`;
  };

  const recomputeRect = () => {
    if (!startDoc || !lastPointer) return;
    const currentDoc = {
      x: lastPointer.clientX + window.scrollX,
      y: lastPointer.clientY + window.scrollY,
    };
    currentRect = {
      x: Math.min(startDoc.x, currentDoc.x),
      y: Math.min(startDoc.y, currentDoc.y),
      width: Math.abs(currentDoc.x - startDoc.x),
      height: Math.abs(currentDoc.y - startDoc.y),
    };
    positionOverlay();
  };

  const cancelAutoScroll = () => {
    if (scrollRafId !== null) {
      cancelAnimationFrame(scrollRafId);
      scrollRafId = null;
    }
  };

  const tickAutoScroll = () => {
    scrollRafId = null;
    if (!dragging || !lastPointer) return;
    const delta = computeAutoScrollDelta(lastPointer.clientY, window.innerHeight);
    if (delta === 0) return;
    window.scrollBy(0, delta);
    recomputeRect();
    scrollRafId = requestAnimationFrame(tickAutoScroll);
  };

  const maybeStartAutoScroll = () => {
    if (scrollRafId !== null) return;
    if (!dragging || !lastPointer) return;
    const delta = computeAutoScrollDelta(lastPointer.clientY, window.innerHeight);
    if (delta === 0) return;
    scrollRafId = requestAnimationFrame(tickAutoScroll);
  };

  const resetDrag = () => {
    dragging = false;
    startDoc = null;
    lastPointer = null;
    currentRect = null;
    cancelAutoScroll();
    hideOverlay();
  };

  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return;
    if (isInSidebarUi(event, sidebarRoot)) return;
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    startDoc = {
      x: event.clientX + window.scrollX,
      y: event.clientY + window.scrollY,
    };
    lastPointer = { clientX: event.clientX, clientY: event.clientY };
    currentRect = { x: startDoc.x, y: startDoc.y, width: 0, height: 0 };
    positionOverlay();
  };

  const onMouseMove = (event: MouseEvent) => {
    if (!dragging) return;
    lastPointer = { clientX: event.clientX, clientY: event.clientY };
    if (moveRafScheduled) return;
    moveRafScheduled = true;
    requestAnimationFrame(() => {
      moveRafScheduled = false;
      recomputeRect();
      maybeStartAutoScroll();
    });
  };

  const onMouseUp = (event: MouseEvent) => {
    if (event.button !== 0 || !dragging) return;
    event.preventDefault();
    event.stopPropagation();
    cancelAutoScroll();
    const finalRect = currentRect;
    dragging = false;
    if (!finalRect || finalRect.width < MIN_RECT_SIZE || finalRect.height < MIN_RECT_SIZE) {
      resetDrag();
      pickerStore.getState().cancel();
      return;
    }
    const capture: RectCapture = {
      kind: "rect",
      rect: { ...finalRect },
      url: window.location.href,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio,
      },
      scroll: { x: window.scrollX, y: window.scrollY },
      capturedAt: Date.now(),
    };
    pickerStore.getState().commit(capture);
    scheduleScreenshot(capture);
  };

  // Suppress the click that follows mouseup so a tiny drag never activates a
  // page link or button.
  const onClick = (event: MouseEvent) => {
    if (isInSidebarUi(event, sidebarRoot)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      pickerStore.getState().cancel();
    }
  };

  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    pickerStore.getState().cancel();
  };

  const onScroll = () => {
    if (dragging) recomputeRect();
  };

  window.addEventListener("mousedown", onMouseDown, { capture: true, signal });
  window.addEventListener("mousemove", onMouseMove, { passive: true, signal });
  window.addEventListener("mouseup", onMouseUp, { capture: true, signal });
  window.addEventListener("click", onClick, { capture: true, signal });
  window.addEventListener("keydown", onKeyDown, { signal });
  window.addEventListener("contextmenu", onContextMenu, { signal });
  window.addEventListener("scroll", onScroll, { passive: true, signal });

  return {
    end: () => {
      abort.abort();
      cancelAutoScroll();
      overlay.remove();
      label.remove();
      document.body.classList.remove(RECT_BODY_ACTIVE_CLASS);
    },
  };
}

interface InitPickerControllerOptions {
  sidebarRoot: Node | null;
  /**
   * Returns whether the user is currently signed in. When this returns false,
   * the picker refuses to enter element or rect mode — regardless of how the
   * mode change was attempted (C/R shortcut, tools menu, or any direct
   * `pickerStore.enterElementMode()` call). Defaults to always-true so
   * pre-existing callers and tests stay green.
   */
  isSignedIn?: () => boolean;
  /**
   * Called when the picker refuses to activate because the user is signed
   * out. The host wires this to surface the existing sign-in CTA (e.g., open
   * the sidebar so `SidebarSignedOut` is visible).
   */
  onActivateBlocked?: () => void;
}

export function initPickerController({
  sidebarRoot,
  isSignedIn = () => true,
  onActivateBlocked,
}: InitPickerControllerOptions): ControllerHandle {
  let active: ActiveSession | null = null;
  let activeMode: PickerMode = "idle";
  let torn = false;

  const ensureSessionFor = (mode: PickerMode) => {
    if (mode === activeMode) return;
    if (active) {
      active.end();
      active = null;
    }
    activeMode = mode;
    if (mode === "element") active = startElementSession(sidebarRoot);
    else if (mode === "rect") active = startRectSession(sidebarRoot);
  };

  const onGlobalKeyDown = (event: KeyboardEvent) => {
    // Element picker: ⌘⇧E / Ctrl+Shift+E. Rectangle: ⌘⇧X / Ctrl+Shift+X.
    // Bare letters got eaten while typing in the popover textarea — multi-key
    // combos plus the shadow-root-aware typing guard prevent that class of bug.
    const hasShortcutMods = (event.metaKey || event.ctrlKey) && event.shiftKey;
    if (!hasShortcutMods) return;
    if (event.altKey) return;

    const isElement = event.code === "KeyE";
    const isRect = event.code === "KeyX";
    if (!isElement && !isRect) return;

    if (isTypingEvent(event)) return;

    if (!isSignedIn()) {
      // Eat the key so the user doesn't get a hidden no-op; surface the
      // sign-in CTA instead.
      event.preventDefault();
      onActivateBlocked?.();
      return;
    }

    if (isElement) {
      if (pickerStore.getState().mode === "element") return;
      event.preventDefault();
      pickerStore.getState().enterElementMode();
      return;
    }
    if (pickerStore.getState().mode === "rect") return;
    event.preventDefault();
    pickerStore.getState().enterRectMode();
  };

  window.addEventListener("keydown", onGlobalKeyDown);

  const unsubscribe = pickerStore.subscribe((state, prev) => {
    if (state.mode === prev.mode) return;
    // Defense-in-depth: if a non-idle mode was set while signed-out (e.g., a
    // tools-menu click slipped through during a session refresh), immediately
    // bounce back to idle and notify the host.
    if (state.mode !== "idle" && !isSignedIn()) {
      pickerStore.getState().cancel();
      onActivateBlocked?.();
      return;
    }
    ensureSessionFor(state.mode);
  });

  ensureSessionFor(pickerStore.getState().mode);

  const teardown = () => {
    if (torn) return;
    torn = true;
    window.removeEventListener("keydown", onGlobalKeyDown);
    unsubscribe();
    if (active) {
      active.end();
      active = null;
    }
  };

  return { teardown };
}
