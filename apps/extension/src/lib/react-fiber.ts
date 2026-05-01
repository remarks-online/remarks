import {
  MAX_REACT_COMPONENTS,
  MAX_REACT_COMPONENT_NAME_LENGTH,
  MAX_REACT_SOURCE_PATH_LENGTH,
  type ReactComponentKind,
  type ReactComponentNode,
} from "@remarks/shared";

// Minimal structural typing of the parts of React's Fiber we touch. The keys
// have been stable since 16.8 and ship in 19; we read them best-effort and
// never rely on numeric tag values, which are an internal detail.
interface FiberLike {
  return: FiberLike | null;
  alternate: FiberLike | null;
  type: unknown;
  elementType: unknown;
  stateNode: unknown;
  _debugSource?: { fileName?: unknown; lineNumber?: unknown; columnNumber?: unknown } | null;
}

const FORWARD_REF = Symbol.for("react.forward_ref");
const MEMO = Symbol.for("react.memo");
const LAZY = Symbol.for("react.lazy");
const PROVIDER = Symbol.for("react.provider");
const CONTEXT = Symbol.for("react.context");

// Fiber back-references hang off the host DOM node under randomly-suffixed
// keys: `__reactFiber$<random>` (React 17+) or `__reactInternalInstance$<...>`
// (React 16). Both still ship in 19. Scanning own-enumerable keys is the
// canonical detection — the DevTools hook is a separate channel that's
// optional and only present when DevTools is installed.
export function getFiberFromElement(el: Element): FiberLike | null {
  for (const key of Object.keys(el)) {
    if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
      const fiber = (el as unknown as Record<string, unknown>)[key];
      return (fiber as FiberLike | undefined) ?? null;
    }
  }
  return null;
}

// React double-buffers fibers via `alternate`; the most-recently-committed
// copy may be either side. Without this we can read stale work-in-progress
// state. Mirrors React DevTools' getNearestMountedFiber behavior at a
// minimum-viable level.
export function getLatestFiber(fiber: FiberLike): FiberLike {
  if (!fiber.alternate) return fiber;
  // Heuristic: walk up both sides, prefer the chain that reaches a HostRoot
  // (its `return` chain terminates at a fiber whose own `return` is null).
  // For our use (display-name extraction) the difference is cosmetic — both
  // alternates carry the same `type`. Pick `fiber` if reachable, else
  // `alternate`. This matches what bippy and DevTools do at this layer.
  let cursor: FiberLike | null = fiber;
  while (cursor) {
    if (cursor.return === null) return fiber;
    cursor = cursor.return;
  }
  return fiber.alternate;
}

function clipName(raw: string): string {
  if (raw.length <= MAX_REACT_COMPONENT_NAME_LENGTH) return raw;
  return `${raw.slice(0, MAX_REACT_COMPONENT_NAME_LENGTH - 1)}…`;
}

export function getDisplayName(type: unknown): string {
  if (type === null || type === undefined) return "Anonymous";
  if (typeof type === "string") return type; // host fiber — caller filters these out
  if (typeof type === "function") {
    const fn = type as { displayName?: unknown; name?: unknown };
    const dn = typeof fn.displayName === "string" ? fn.displayName : undefined;
    const nm = typeof fn.name === "string" ? fn.name : undefined;
    return clipName(dn || nm || "Anonymous");
  }
  if (typeof type === "object") {
    const obj = type as {
      displayName?: unknown;
      $$typeof?: symbol;
      type?: unknown;
      render?: unknown;
      _payload?: { _result?: unknown } | null;
    };
    const dn = typeof obj.displayName === "string" ? obj.displayName : undefined;
    if (dn) return clipName(dn);
    if (obj.$$typeof === FORWARD_REF) {
      const inner = getDisplayName(obj.render);
      return clipName(`ForwardRef(${inner})`);
    }
    if (obj.$$typeof === MEMO) {
      const inner = getDisplayName(obj.type);
      return clipName(`Memo(${inner})`);
    }
    if (obj.$$typeof === LAZY) {
      const result = obj._payload?._result;
      if (result) return clipName(`Lazy(${getDisplayName(result)})`);
      return "Lazy";
    }
    if (obj.$$typeof === PROVIDER) return "Provider";
    if (obj.$$typeof === CONTEXT) return "Context";
  }
  return "Anonymous";
}

function classifyKind(type: unknown): ReactComponentKind {
  if (typeof type === "function") {
    const fn = type as { prototype?: { isReactComponent?: unknown } };
    if (fn.prototype && (fn.prototype as { isReactComponent?: unknown }).isReactComponent) {
      return "class";
    }
    return "function";
  }
  if (typeof type === "object" && type !== null) {
    const tag = (type as { $$typeof?: symbol }).$$typeof;
    if (tag === FORWARD_REF) return "forward_ref";
    if (tag === MEMO) return "memo";
    if (tag === LAZY) return "lazy";
    if (tag === PROVIDER) return "provider";
    if (tag === CONTEXT) return "context";
  }
  return "other";
}

function isHostFiber(fiber: FiberLike): boolean {
  // HostComponent / HostText / HostRoot / HostPortal — `type` is a string for
  // HostComponent (e.g. "div"), null/undefined for the other host kinds. We
  // walk through them so the chain shows only React components.
  return typeof fiber.type === "string" || fiber.type === null || fiber.type === undefined;
}

export function getSource(fiber: FiberLike): ReactComponentNode["source"] | undefined {
  // `_debugSource` ships in dev builds for React ≤18 and was removed entirely
  // in React 19 in favor of `_debugStack` (an Error). We don't try to parse
  // _debugStack here — sourcemap-resolved frames are tracked as spec-gap A24.
  const src = fiber._debugSource;
  if (!src) return undefined;
  const fileName = typeof src.fileName === "string" ? src.fileName : undefined;
  const lineNumber = typeof src.lineNumber === "number" ? src.lineNumber : undefined;
  if (!fileName || lineNumber === undefined || lineNumber < 0) return undefined;
  const columnNumber = typeof src.columnNumber === "number" ? src.columnNumber : undefined;
  const clippedFile =
    fileName.length > MAX_REACT_SOURCE_PATH_LENGTH
      ? fileName.slice(fileName.length - MAX_REACT_SOURCE_PATH_LENGTH)
      : fileName;
  return columnNumber !== undefined && columnNumber >= 0
    ? { fileName: clippedFile, lineNumber, columnNumber }
    : { fileName: clippedFile, lineNumber };
}

function fiberToNode(fiber: FiberLike): ReactComponentNode {
  // Prefer `elementType` so memo/forwardRef wrappers are preserved; fall back
  // to `type` if elementType is missing (very old React or unmounted fibers).
  const reified = fiber.elementType ?? fiber.type;
  const node: ReactComponentNode = {
    name: getDisplayName(reified),
    kind: classifyKind(reified),
  };
  const source = getSource(fiber);
  if (source) node.source = source;
  return node;
}

// Walk `return` from the picked element's fiber to the root, collecting one
// entry per non-host fiber. Adjacent identical names are deduplicated to
// suppress StrictMode double-renders and forwardRef/memo wrappers that share
// a displayName with their inner component.
export function walkComponentChain(
  startFiber: FiberLike,
  maxDepth: number = MAX_REACT_COMPONENTS
): ReactComponentNode[] {
  const out: ReactComponentNode[] = [];
  let cursor: FiberLike | null = getLatestFiber(startFiber);
  let lastName: string | null = null;
  while (cursor && out.length < maxDepth) {
    if (!isHostFiber(cursor)) {
      const node = fiberToNode(cursor);
      if (node.name !== lastName) {
        out.push(node);
        lastName = node.name;
      }
    }
    cursor = cursor.return;
  }
  return out;
}
