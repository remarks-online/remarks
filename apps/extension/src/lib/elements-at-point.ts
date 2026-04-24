export interface ElementsAtPointOptions {
  maxShadowDepth?: number;
}

export function elementAtPoint(
  x: number,
  y: number,
  root: Document | ShadowRoot = document,
  opts: ElementsAtPointOptions = {}
): Element | null {
  const maxDepth = opts.maxShadowDepth ?? 5;
  let current: Element | null = root.elementFromPoint(x, y);
  let depth = 0;

  while (current && depth < maxDepth) {
    const shadow = (current as Element & { shadowRoot: ShadowRoot | null }).shadowRoot;
    if (!shadow) break;
    const inner = shadow.elementFromPoint(x, y);
    // If shadow returns the same element or nothing, stop descending.
    if (!inner || inner === current) break;
    current = inner;
    depth++;
  }

  return current;
}
