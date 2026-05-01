import { getFiberFromElement, walkComponentChain } from "@/lib/react-fiber";
import type { ReactComponentNode } from "@remarks/shared";

// Tag the picker uses to single out the element it wants fiber data for. Kept
// in sync with apps/extension/src/lib/fiber-bridge.ts (isolated-world side).
const TARGET_ATTR = "data-remarks-fiber-req";
const REQUEST_TYPE = "remarks:fiber-request";
const RESPONSE_TYPE = "remarks:fiber-response";

interface FiberRequest {
  type: typeof REQUEST_TYPE;
  nonce: string;
}

interface FiberResponse {
  type: typeof RESPONSE_TYPE;
  nonce: string;
  components: ReactComponentNode[];
  frameworkDetected: boolean;
}

function isFiberRequest(value: unknown): value is FiberRequest {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { type?: unknown; nonce?: unknown };
  return v.type === REQUEST_TYPE && typeof v.nonce === "string" && v.nonce.length > 0;
}

// Defined as a separate function (not inline in the listener) so a single
// thrown error inside the fiber walk can't leak past our try/catch and tear
// down listeners we don't own.
function buildResponse(nonce: string): FiberResponse {
  // Selector escape: nonces are crypto.randomUUID strings (lowercase hex +
  // dashes), but we still escape to keep this safe if the contract ever
  // loosens. CSS.escape is not always present in older runtimes; fall back to
  // a trivial whitelist check.
  const safeNonce =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(nonce)
      : /^[a-zA-Z0-9-_]+$/.test(nonce)
        ? nonce
        : "";
  if (!safeNonce) {
    return { type: RESPONSE_TYPE, nonce, components: [], frameworkDetected: false };
  }
  const target = document.querySelector(`[${TARGET_ATTR}="${safeNonce}"]`);
  if (!target) {
    return { type: RESPONSE_TYPE, nonce, components: [], frameworkDetected: false };
  }
  const fiber = getFiberFromElement(target);
  if (!fiber) {
    return { type: RESPONSE_TYPE, nonce, components: [], frameworkDetected: false };
  }
  const components = walkComponentChain(fiber);
  return { type: RESPONSE_TYPE, nonce, components, frameworkDetected: true };
}

export default defineContentScript({
  matches: ["<all_urls>"],
  // Mirrors apps/extension/src/entrypoints/content.tsx — keep these in sync so
  // the bridge runs everywhere the picker can run, and nowhere it can't.
  excludeMatches: [
    "https://accounts.google.com/*",
    "https://appleid.apple.com/*",
    "https://clerk.remarks.online/*",
    "https://*.clerk.accounts.dev/*",
  ],
  // Page's MAIN world: the only place __reactFiber$* keys and React internals
  // are visible. Chrome 102+. Firefox is out of scope for this entry; revisit
  // with `injectScript` from web_accessible_resources when we ship there.
  world: "MAIN",
  // document_start so we're listening before the picker can dispatch its
  // first request — the popover may open within milliseconds of page interaction.
  runAt: "document_start",
  allFrames: false,
  main() {
    const listener = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (!isFiberRequest(event.data)) return;
      let response: FiberResponse;
      try {
        response = buildResponse(event.data.nonce);
      } catch {
        // Never let a fiber-internals change throw into the page's main loop.
        // An empty response is indistinguishable from "not a React page" to
        // the picker, which is the right fallback.
        response = {
          type: RESPONSE_TYPE,
          nonce: event.data.nonce,
          components: [],
          frameworkDetected: false,
        };
      }
      window.postMessage(response, "*");
    };
    window.addEventListener("message", listener);
  },
});
