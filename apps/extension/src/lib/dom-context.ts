import { MAX_TEXT_CONTENT_LENGTH, type domContextSchema } from "@remarks/shared";
import type { z } from "zod";

export type DomContext = z.infer<typeof domContextSchema>;
export type AncestorSnapshot = NonNullable<DomContext["ancestors"]>[number];

const MAX_CLASSES = 16;
const MAX_ANCESTORS = 5;
const MAX_COMPUTED_STYLE_KEYS = 40;

// Curated whitelist of computed CSS properties surfaced to reviewers. Full
// getComputedStyle() returns hundreds of resolved properties — most are noise.
// Grouped by intent: layout, flex/grid, visual, typography.
const COMPUTED_STYLE_PROPS = [
  "display",
  "position",
  "z-index",
  "top",
  "right",
  "bottom",
  "left",
  "box-sizing",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "margin",
  "padding",
  "overflow",
  "flex",
  "flex-direction",
  "justify-content",
  "align-items",
  "gap",
  "grid-template-columns",
  "grid-template-rows",
  "color",
  "background-color",
  "background-image",
  "border",
  "border-radius",
  "box-shadow",
  "opacity",
  "cursor",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "text-decoration",
] as const;

// Default-equivalent values that add no signal — drop to keep the panel scannable.
const NOISE_VALUES = new Set(["", "none", "normal", "auto", "rgba(0, 0, 0, 0)"]);

function tagName(el: Element): string {
  return el.namespaceURI === "http://www.w3.org/2000/svg" ? el.tagName : el.tagName.toLowerCase();
}

function classList(el: Element): string[] {
  return Array.from(el.classList).filter(Boolean).slice(0, MAX_CLASSES);
}

function textContent(el: Element): string | undefined {
  const raw = el.textContent?.trim();
  if (!raw) return undefined;
  if (raw.length <= MAX_TEXT_CONTENT_LENGTH) return raw;
  return `${raw.slice(0, MAX_TEXT_CONTENT_LENGTH - 1)}…`;
}

function snapshotAncestor(el: Element): AncestorSnapshot {
  const classes = classList(el);
  return classes.length > 0 ? { tagName: tagName(el), classes } : { tagName: tagName(el) };
}

function computedStyles(el: Element): Record<string, string> | undefined {
  const view = el.ownerDocument?.defaultView;
  if (!view) return undefined;
  const style = view.getComputedStyle(el);
  const out: Record<string, string> = {};
  let count = 0;
  for (const prop of COMPUTED_STYLE_PROPS) {
    if (count >= MAX_COMPUTED_STYLE_KEYS) break;
    const value = style.getPropertyValue(prop).trim();
    if (NOISE_VALUES.has(value)) continue;
    out[prop] = value;
    count++;
  }
  return count > 0 ? out : undefined;
}

export function buildDomContext(el: Element): DomContext {
  const ctx: DomContext = {
    tagName: tagName(el),
  };

  const classes = classList(el);
  if (classes.length > 0) ctx.classes = classes;

  const text = textContent(el);
  if (text !== undefined) ctx.textContent = text;

  const styles = computedStyles(el);
  if (styles !== undefined) ctx.computedStyles = styles;

  const ancestors: AncestorSnapshot[] = [];
  let node = el.parentElement;
  const stopAt = el.ownerDocument?.body ?? null;
  while (node && node !== stopAt && ancestors.length < MAX_ANCESTORS) {
    ancestors.push(snapshotAncestor(node));
    node = node.parentElement;
  }
  if (ancestors.length > 0) ctx.ancestors = ancestors;

  return ctx;
}
