import type { ReactComponentNode } from "@remarks/shared";

const TARGET_ATTR = "data-remarks-fiber-req";
const REQUEST_TYPE = "remarks:fiber-request";
const RESPONSE_TYPE = "remarks:fiber-response";
const DEFAULT_TIMEOUT_MS = 250;

export interface FiberBridgeResult {
  components: ReactComponentNode[];
  frameworkDetected: boolean;
}

interface FiberResponseMessage {
  type: typeof RESPONSE_TYPE;
  nonce: string;
  components: ReactComponentNode[];
  frameworkDetected: boolean;
}

function isFiberResponse(value: unknown, nonce: string): value is FiberResponseMessage {
  if (typeof value !== "object" || value === null) return false;
  const v = value as {
    type?: unknown;
    nonce?: unknown;
    components?: unknown;
    frameworkDetected?: unknown;
  };
  return (
    v.type === RESPONSE_TYPE &&
    v.nonce === nonce &&
    Array.isArray(v.components) &&
    typeof v.frameworkDetected === "boolean"
  );
}

function makeNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Last-resort entropy for environments that don't expose Web Crypto. Not
  // load-bearing for security; the nonce only protects against concurrent
  // request/response interleaving.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// Asks the MAIN-world fiber-bridge content script for the React component
// chain that rendered `el`. Returns null on timeout / messaging failure;
// returns { components: [], frameworkDetected: false } when React isn't
// detected. Never throws — the picker uses this as enrichment, not a
// blocking step.
export function requestReactComponents(
  el: Element,
  opts: { timeoutMs?: number } = {}
): Promise<FiberBridgeResult | null> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise<FiberBridgeResult | null>((resolve) => {
    const nonce = makeNonce();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      window.removeEventListener("message", listener);
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      // Best-effort attribute cleanup; if the element has been removed from
      // the DOM by the page's React tree (common after a click triggers a
      // re-render), removeAttribute is a no-op.
      try {
        el.removeAttribute(TARGET_ATTR);
      } catch {
        // Ignore — element may be disconnected or frozen.
      }
    };

    const settle = (value: FiberBridgeResult | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const listener = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (!isFiberResponse(event.data, nonce)) return;
      settle({
        components: event.data.components,
        frameworkDetected: event.data.frameworkDetected,
      });
    };

    try {
      el.setAttribute(TARGET_ATTR, nonce);
    } catch {
      resolve(null);
      return;
    }
    window.addEventListener("message", listener);
    timer = setTimeout(() => settle(null), timeoutMs);
    window.postMessage({ type: REQUEST_TYPE, nonce }, "*");
  });
}
