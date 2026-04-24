/** Test-only DOM query helper that asserts presence instead of using `!`. */
export function q<T extends Element = Element>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`expected element for selector: ${selector}`);
  return el;
}

export function qa<T extends Element = Element>(
  selector: string,
  root: ParentNode = document
): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`expected element with id: ${id}`);
  return el;
}
