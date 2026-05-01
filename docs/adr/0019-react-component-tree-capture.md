# 0019. React component-tree capture in element annotations

Date: 2026-05-01
Status: Accepted

## Context

Element annotations today persist a `domContext` JSONB blob containing `tagName`, `classes`, `textContent`, `computedStyles`, and an ancestor breadcrumb. For React applications, none of that surfaces *which component rendered the element* — agents and human reviewers see "this is a `<button class="primary">`" but not "this is `<SubmitButton />` inside `<CheckoutForm />`."

The April 2026 agentation vs. Remarks gap analysis flagged this as task **G13** (`docs/analysis/2026-04-30-agentation-vs-remarks.md`). Closing it dramatically improves the "where in code" signal that agents need to act on a task, especially when CSS selectors are unstable across deploys.

The implementation crosses two browser-extension execution worlds:

- The picker's UI runs inside a shadow root attached by the content script — that's the **isolated world**, where `chrome.*` APIs and our React sidebar live.
- The page's React internals (the per-Element `__reactFiber$<random>` keys, `__REACT_DEVTOOLS_GLOBAL_HOOK__`) live in the page's **MAIN world**, which the isolated world cannot read directly.

This is a load-bearing design constraint, not a workaround.

## Decision

Add a `domContext.reactComponents: ReactComponentNode[]` field that captures the leaf-to-root chain of components that rendered the picked element, plus a `frameworkHint` column populated when React is detected.

**Schema (no migration).** `domContext` is JSONB; `domContextSchema` and `domContextResponseSchema` in `packages/shared/src/schemas/annotation.ts` gain a new optional/nullable `reactComponents` sub-field. `frameworkHint` already exists on the DB row and the create-request schema; this ADR adds it to `annotationResponseSchema` and `toAnnotationResponse` so the dashboard and MCP both see it.

```ts
type ReactComponentNode = {
  name: string;            // displayName → name → "Anonymous"; bounded length
  kind:
    | "function" | "class" | "forward_ref" | "memo"
    | "lazy" | "provider" | "context" | "other";
  source?: { fileName: string; lineNumber: number; columnNumber?: number };
};
```

Order is leaf-to-root, mirroring how `ancestors` is stored. The chain caps at `MAX_REACT_COMPONENTS = 12` to bound the JSONB payload. Adjacent identical names are deduplicated to suppress StrictMode and `memo`/`forwardRef` wrapper noise.

**Two-world bridge.** A second WXT content-script entry, `apps/extension/src/entrypoints/fiber-bridge.content.ts`, registers with `world: "MAIN"` and runs at `document_start`. It listens for `window.postMessage({ type: "remarks:fiber-request", nonce })`, locates the target element via a temporary `data-remarks-fiber-req="<nonce>"` attribute, walks the fiber, and replies with `{ type: "remarks:fiber-response", nonce, components, frameworkDetected }`. The picker's isolated-world side (`apps/extension/src/lib/fiber-bridge.ts`) tags the element, awaits the response with a 250ms timeout, and merges results into the in-flight capture via `pickerStore.attachReactInfo`.

**No third-party dep.** `bippy` (MIT, ~4kb) was the obvious candidate, but the actual fiber walk is ~50 lines of well-known DevTools-equivalent logic, and bippy's strengths (render-tracking via `__REACT_DEVTOOLS_GLOBAL_HOOK__` patching) are not what we need. We re-evaluate if a future feature wants render-time hooks.

**Async enrichment.** `buildDomContext` stays synchronous and runs at click-time before the screenshot rAF, so screenshot timing is unchanged. The fiber walk fires fire-and-forget after `commit()`; the popover already subscribes to the picker store and re-renders when React data lands.

## Consequences

**Wins.** Agents acting on annotations now see the responsible component(s). The dashboard `MetadataPanel` surfaces both a `Framework` row (currently `React`) and a `Components` row showing the leaf-to-root chain. MCP responses pass `frameworkHint` and the new `reactComponents` through with no further work — `getAnnotationById` and `listAnnotationsForUser` already select all annotation columns, and `toDomContextResponse` was extended to map the new sub-field.

**Costs.** A second content-script entry that runs in every matching tab — but it does nothing until a postMessage arrives, so the steady-state cost is one window-message listener per page. The MAIN-world script can't access `chrome.*` APIs and can throw inside the page; we wrap the fiber walk in `try/catch` so the page never sees an unhandled error from the bridge.

**Limitations.** All documented in code comments and the gap-analysis follow-ups (A24 / A25 in `docs/plan/spec-gaps.md`):

- Production-minified component names degrade to `"t"`, `"n"`, etc. We surface whatever React did — sourcemap-resolved names are tracked as A24.
- React 19 removed `_debugSource`, replacing it with `_debugStack` (an `Error`). Source location is dev-only, best-effort. Sourcemap-based recovery is A24.
- React Server Component fibers (Next.js App Router) have undefined `_debugOwner` and `_debugSource` (vercel/next.js#59457). Server-rendered subtrees in the chain return blanks for `source`.
- Cross-frame iframes have separate React instances and a separate MAIN world. Out of scope; the picker also runs `allFrames: false`.
- Firefox MV3 doesn't honor `world: "MAIN"`; the bridge is a no-op there. Will need WXT's `injectScript` fallback when we ship Firefox.

## Alternatives considered

- **bippy** (MIT). Ergonomic, actively maintained, ~4kb. Rejected for now: the in-house walk is small enough that the dependency cost (one more thing to load into every page's MAIN world) outweighs the savings. Revisit if we want render-tracking later.
- **react-fiber-traverse**. Unmaintained (last meaningful release 2019), based on legacy DevTools internals.
- **React DevTools backend** as a peer. Hooks `__REACT_DEVTOOLS_GLOBAL_HOOK__` and gives us the full inspector, but it's a heavyweight dep designed for an external client. Wrong shape.
- **A `react-devtools-core`-style protocol** (postMessage transport, full tree). Overkill; we want one walk per click, not a live tree.
- **Capturing component info synchronously in the isolated world** by injecting an inline `<script>` that exposes a global. Possible but messy: violates strict-CSP pages, and the global lifecycle is harder to reason about than a content-script entry that's part of WXT's manifest.
