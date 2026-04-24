import { MAX_TEXT_CONTENT_LENGTH, type domContextSchema } from "@remarks/shared";
import type { z } from "zod";

export type DomContext = z.infer<typeof domContextSchema>;
export type AncestorSnapshot = NonNullable<DomContext["ancestors"]>[number];

const MAX_CLASSES = 16;
const MAX_ANCESTORS = 5;

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

export function buildDomContext(el: Element): DomContext {
  const ctx: DomContext = {
    tagName: tagName(el),
  };

  const classes = classList(el);
  if (classes.length > 0) ctx.classes = classes;

  const text = textContent(el);
  if (text !== undefined) ctx.textContent = text;

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
