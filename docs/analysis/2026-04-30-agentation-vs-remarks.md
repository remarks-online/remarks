# Agentation vs. Remarks — gap analysis

Date: 2026-04-30
Status: Analysis — P0 (G1/G2/G3/X1) shipped via ADR-0016 + migration 0007; P1 agent-loop (G4/G6/G7/G8) shipped via ADR-0018 on 2026-05-01; remaining specs are pull-from-this-list

## Context

This document compares **agentation.com** (a developer-feedback tool that injects a `<Agentation />` React component into a dev-mode app and exposes annotations to AI coding agents over MCP) with the **Remarks** project in this repo (a browser-extension + Next.js dashboard + Fastify API + Postgres/R2 backend, also exposing annotations to agents over MCP via OAuth 2.1 / DCR).

**Why this analysis:** Agentation occupies an adjacent niche — same agent-feedback DNA, narrower surface, and they have shipped a few patterns we haven't. The output is two things in one document:

1. A **report** of where the products converge, diverge, and where Remarks has a real gap.
2. An **itemized feature-spec list** the team can pull tasks from. Each spec lists what to build, where in the codebase it lands, and a rough size.

The intent is *not* "port agentation feature-for-feature." Remarks has structural advantages (multi-tenant SaaS, R2 screenshots, OAuth-backed MCP, branch-scoped annotations) that agentation explicitly lacks. We borrow what makes agent UX tighter and what closes documented Remarks gaps; we skip what would be regressive.

Sources for the agentation side: home, blog (introducing-agentation-2), GitHub `benjitaylor/agentation`, npm `agentation`, Product Hunt. Sources for Remarks: code under `apps/api`, `apps/dashboard`, `apps/extension`, `packages/db`, `packages/ui`.

---

## Positioning summary

**Agentation** is a thin, dev-time tool: drop `<Agentation />` into your React app in `NODE_ENV !== "production"`, click DOM elements, type comments, and the tool generates structured markdown with CSS selectors / React component trees / computed styles for an agent to act on. Storage is local (SQLite or in-memory) and per-machine. MCP is stdio. No multi-user, no screenshots, no SaaS — explicitly desktop-only, React-18+-only, main-document-only. Pricing is "free for dev / commercial license on contact" under PolyForm Shield.

**Remarks** is the SaaS shape of the same idea: a browser extension (works on any site, not only your own React app) capturing **element / rectangle / route** annotations + screenshots, syncing to a hosted backend, with org/project/branch scoping, RBAC, OAuth-DCR-backed MCP, R2 asset storage, and Inngest cleanup jobs. We have screenshots; agentation has none. Agentation has a richer annotation **schema** (intent / severity / kind / acknowledged status / threaded replies in the canonical AFS schema) and a richer **agent-loop API** (acknowledge, dismiss with reason, reply, watch, plus SSE event streams and webhooks).

The honest framing: **Remarks is broader and shippable as a product; agentation is narrower but has chewed harder on the agent-collaboration UX.** Most useful gaps are in the schema and the agent-feedback loop, not the capture surface.

---

## What Remarks already has that agentation doesn't (skip-don't-port)

- Screenshot capture + R2 asset storage with presigned URLs and orphan sweep (`apps/api/src/routes/uploads`, Inngest `r2.orphan-sweep`).
- Multi-tenant orgs/projects with RBAC (admin/editor/viewer) and personal scope.
- Hosted, signed-in dashboard with annotation browser, detail sheet, status management.
- Per-branch annotations (`branches` table, branch picker in the extension).
- OAuth 2.1 + DCR-backed MCP (agentation's MCP is stdio; ours is web-flow).
- Clerk identity sync via Svix webhooks; agent attribution on annotation events via `actorOauthClientId` (ADR-0015).
- Personal vs. org scope split with proper schema-level check constraints.

These are *not* gaps. Don't regress on them while implementing items below.

---

## Gap themes (where we'd benefit)

1. **Annotation schema is too thin.** Agentation's AFS 1.1 distinguishes `intent` (fix / change / question / approve), `severity` (blocking / important / suggestion), and `kind` (feedback / placement / rearrange). We have only `status` and `targetType`. Without intent/severity, agents can't prioritize and humans can't filter. Highest-leverage gap.
2. **Agent-loop API is too coarse.** Our status enum is `to_do | doing | done | rejected`. Agentation distinguishes **acknowledged** (agent saw it, hasn't acted) from **resolved** (agent took action), and supports **dismiss with reason**. The `acknowledged` state is the missing link for hands-free loops.
3. **No live event stream.** Agentation has SSE (`/sessions/:id/events` and global `/events` with domain filter) and outbound webhooks. Remarks has neither. Today an agent has to poll. This blocks any "watch_annotations" tool.
4. **No outbound webhooks.** Customers integrating Remarks into Linear/Jira/Slack today have no path. Agentation ships first-class webhooks.
5. **Element-context capture is shallower.** Agentation traverses React Fiber for component tree, captures computed styles on hover, and detects source file:line in dev. We capture selector + classes + text + ancestors. Adding component-tree + computed-style capture would close most of the "agent location precision" gap.
6. **No animation pause / freeze for capture.** Agentation pauses CSS / JS / Web Animations for crisp captures. We screenshot whatever frame we hit.
7. **No text-selection annotations.** We support element / rect / route. Agentation supports selecting and quoting actual page text — useful for copy/typo feedback.
8. **No multi-element / batch select.** One annotation per pick today. Agentation has bulk-select green markers.
9. **No output-format export.** Agentation can render a session as Compact / Standard / Detailed / Forensic markdown. Remarks has no "export this annotation set as markdown for an agent."
10. **No layout/wireframe mode.** Agentation v3 ships a drag-65-components-onto-the-page wireframe builder. Speculative; only relevant if Remarks moves toward design-handoff territory. Listed as P3.
11. **No threaded reply UX distinct from comments.** Agentation models a `thread` array of human↔agent turns with explicit author roles. Our `annotationEvents` log can encode this but the dashboard renders flat comments.
12. **No "pending" filter for agents.** Agentation has `get_pending` / `get_all_pending` for triage. We have status filters but no "things no agent has acknowledged yet" view.

---

## Itemized feature specs

Specs are grouped by surface, ordered roughly by leverage. Each entry: ID, name, why, what, where, size (S ≤ 1d, M ≤ 3d, L ≤ 1w, XL > 1w), dependencies.

### Schema / DB (`packages/db`)

**G1. Add `intent` enum to annotations** — *S, no deps, blocks G3/G6/D2* — **DONE 2026-04-30 (ADR-0016, migration 0007)**
*Why:* Agents need to know "is this a fix request, a question, an approval, or a change suggestion?" Without it, every annotation looks the same.
*What:* New enum `annotation_intent_enum` = `fix | change | question | approve`, nullable column `intent` on `annotations` (default null, backfill not required), Drizzle migration, expose on REST + tRPC + MCP read paths.
*Where:* `packages/db/src/schema.ts`, new migration, `apps/api/src/schemas/annotation.ts`, `apps/api/src/routes/annotations/*`, `apps/api/src/routes/internal/mcp/*`.

**G2. Add `severity` enum to annotations** — *S, no deps* — **DONE 2026-04-30 (ADR-0016, migration 0007)**
*Why:* Lets agents and humans triage; lets dashboard sort by what's blocking.
*What:* `annotation_severity_enum` = `blocking | important | suggestion`, nullable column. Same surface as G1.
*Where:* same.

**G3. Add `acknowledged` annotation status** — *S, depends on G1 conceptually* — **DONE 2026-04-30 (ADR-0016, migration 0007; MCP `update_task_status` accepts `acknowledged`, transitions emit `agent_acknowledged` events)**
*Why:* The hands-free agent loop needs an "I saw it but haven't acted" state distinct from `doing` (working on it now) and `done` (action complete).
*What:* Extend `annotation_status_enum` with `acknowledged`. New event type `agent_acknowledged` on `annotation_event_type_enum`. Update MCP status-set guardrails (`apps/api/src/routes/internal/mcp/annotations/*` already restricts agents to `doing | done | rejected`; add `acknowledged`).
*Where:* `packages/db/src/schema.ts`, MCP status route, dashboard status UI (`apps/dashboard/src/components/annotations/status-ui.ts`).

**G4. Add `dismiss_reason` to events on rejected status** — *S* — **DONE 2026-05-01 (statusUpdateBodySchema requires `reason` 10–500 chars when `status === "rejected"` via shared `rejectionReasonSchema`; dashboard `event-row.tsx` surfaces `payload.reason` inline on rejected status changes)**
*Why:* Today rejection is opaque. Agentation requires a reason on dismiss; reviewers need this.
*What:* When status changes to `rejected`, require a `reason` field on the body that lands in `payload.reason` on the resulting event. Validate in the route schema. Surface in detail sheet.
*Where:* `apps/api/src/routes/internal/annotations.ts`, `apps/dashboard/src/components/annotations/event-row.tsx`.

**G5. Optional: `kind` enum (feedback/placement/rearrange)** — *S, depends on layout-mode (P3)*
*Why:* Only meaningful if we ship layout mode (G19). Until then, every annotation is implicitly `feedback`. Listed for completeness.
*What:* Defer until layout work begins.

### API / agent loop (`apps/api`)

**G6. MCP tool: `acknowledge` with optional comment** — *S, depends on G3* — **DONE 2026-05-01 (ADR-0018; `remarks_acknowledge` flips status to `acknowledged` and optionally appends an `agent_commented` event; supports flexible `kind`)**
*Why:* Mirrors `agentation_acknowledge`. Distinguishes "agent has read this" from "agent is doing it."
*What:* New MCP tool that hits `POST /internal/mcp/annotations/:id/status` with `acknowledged` and optionally appends an `agent_commented` event with `kind: "clarification_request"` already supported.
*Where:* `apps/mcp/src/tools/acknowledge.ts`, schema in `packages/mcp-schema/src/tools.ts`.

**G7. MCP tool: `dismiss` with required reason** — *S, depends on G4* — **DONE 2026-05-01 (ADR-0018; `remarks_dismiss` requires `reason` ≥ 10 chars; API route enforces same floor on direct calls)**
*Why:* Pair with G4 — agents need to express *why* something can't be done.
*What:* Wraps `status=rejected` + reason payload. Validate reason ≥ 10 chars.
*Where:* `apps/mcp/src/tools/dismiss.ts`, schema in `packages/mcp-schema/src/tools.ts`.

**G8. MCP tool: `get_pending` (per-project) and `get_all_pending` (per-user)** — *S* — **DONE 2026-05-01 (ADR-0018; `remarks_get_pending` wraps project list with `to_do + acknowledged` filter; `remarks_get_all_pending` wraps new `/internal/mcp/users/:clerkUserId/all-annotations` aggregator endpoint that reuses listAnnotationsForUser's "all" scope)**
*Why:* Triage view: what hasn't been picked up yet. Today an agent has to filter `to_do` client-side after `list`.
*What:* Two thin wrappers over existing list endpoints with `status=to_do` (and post-G3, possibly `to_do OR acknowledged-but-not-doing`).
*Where:* `apps/mcp/src/tools/get-pending.ts`, `apps/mcp/src/tools/get-all-pending.ts`, new aggregator route in `apps/api/src/routes/internal/annotations.ts`.

**G9. SSE event stream — per-project and per-user** — *M*
*Why:* Powers `watch_annotations`-style agent loops, live dashboard activity feeds, and is required infrastructure for any "real-time" UX. Without it, agents poll.
*What:* `GET /projects/:projectId/events?since=...` and `GET /users/:userId/events?since=...` (internal-auth + Clerk variants). Events: annotation.created, annotation.updated, status.changed, comment.added, asset.attached. Use Postgres LISTEN/NOTIFY or Redis pub/sub from the existing `annotationEvents` insert path. Include `Last-Event-ID` resume support. Cap connection time, document keep-alive.
*Where:* `apps/api/src/routes/events/*` (new), wire into `annotationEvents` write path. Likely needs Upstash Redis (already in env per CLAUDE.md §1.8 — confirm).
*Risks:* Fly.io + Fastify SSE behavior under HTTP/2; load shape of long-lived connections; Redis vs PG-NOTIFY tradeoff.

**G10. MCP tool: `watch_annotations`** — *M, depends on G9*
*Why:* The hands-free loop. Agent calls this once and gets streamed annotations to act on.
*What:* MCP-side tool that subscribes to G9's stream and yields events as tool results. Define cancellation semantics.
*Where:* MCP server.

**G11. Outbound webhooks (project-level config + delivery)** — *M*
*Why:* Customers want Linear / Jira / Slack notifications when annotations are created. Without webhooks, every integration is a custom build.
*What:*
- New table `project_webhooks` (id, projectId, url, secret, events[], active, createdAt). Migration in `packages/db`.
- Settings page on project detail: add/edit/delete webhooks, choose events.
- Deliverer: Inngest function consuming `annotation.*` events, signing with `secret` (HMAC-SHA256), retry-with-exponential-backoff, dead-letter after N attempts.
- Receipts table `project_webhook_deliveries` for debugging.
*Where:* `packages/db/src/schema.ts`, `apps/api/src/routes/projects/[id]/webhooks/*`, `apps/api/src/inngest/functions/webhook-deliver.ts`, `apps/dashboard/src/app/app/projects/[slug]/settings/_components/webhooks-form.tsx`.
*Constitutional check:* New runtime dep risk is low (Inngest already used; HMAC via Node `crypto`). Document in PR per CLAUDE.md §1.10.

### Extension (`apps/extension`)

**G12. Computed-styles overlay on hover** — *S* — *partially shipped per recent commit `27e1e6c`*
*Why:* "show selected element + path + computed CSS in capture popover" landed last week — verify it covers hover, not just post-pick. Agentation surfaces computed styles inline on hover before commit.
*What:* If hover-mode is missing, extend `picker-controller.ts` to render a transient computed-styles tooltip while picking (font / color / spacing). Keep behind a setting; could be noisy.
*Where:* `apps/extension/src/lib/picker-controller.ts`, `apps/extension/src/components/CapturePromptPopover.tsx`.

**G13. React component-tree detection (Fiber traversal)** — *M, **DONE 2026-05-01 (ADR-0019)***
*Why:* For React apps, "this annotation is on `<Dashboard><SubmitButton />>`" is more agent-actionable than a CSS selector. Closes most of the "where in code" gap.
*What:* `apps/extension/src/lib/react-fiber.ts` walks fibers via `__reactFiber$*` keys; a MAIN-world WXT entrypoint (`fiber-bridge.content.ts`) bridges into the picker via `postMessage`; results land on `domContext.reactComponents` (extended Zod schema, no DB migration) plus `frameworkHint = "react"` on detection. Surfaced in extension popover and dashboard `MetadataPanel`. Sourcemap resolution + editor-jump links broken out as spec-gaps **A24** + **A25**.
*Where:* `apps/extension/src/lib/react-fiber.ts`, `apps/extension/src/lib/fiber-bridge.ts`, `apps/extension/src/entrypoints/fiber-bridge.content.ts`, `packages/shared/src/schemas/annotation.ts`, `apps/api/src/services/annotation.service.ts`, `apps/dashboard/src/components/annotations/annotation-detail-sheet.tsx`.
*Risks:* Production-minified React loses display names (accepted); React 19 removed `_debugSource` (accepted, A24 covers sourcemap recovery); Firefox MV3 doesn't honor `world: "MAIN"` (out of scope for Chromium-only).

**G14. Source file detection (file:line) in dev mode** — *S–M, depends on G13 codepath* — **DONE 2026-05-01**
*Why:* Same goal as G13 but more direct: if Vite/webpack source maps expose `__source` on Fiber nodes (React DevTools does this), capture file:line and ship it.
*What shipped:* Capture half landed under G13/ADR-0019 — `getSource()` in `apps/extension/src/lib/react-fiber.ts` reads `_debugSource` per fiber and produces `{ fileName, lineNumber, columnNumber }` on each `domContext.reactComponents[i].source`. The per-component shape is a strict superset of the originally-proposed top-level `domContext.sourceLocation`: minified production wrappers often have no source on the leaf even when a parent does, so a per-fiber field lets the renderer pick the leaf-most populated entry. MCP output already exposes the chain via `getMcpAnnotationById` (no service change). Surfacing half: dashboard `MetadataPanel` now renders a visible `Source` row with `file:line[:col]` when any component in the chain has `source` (was tooltip-only). Coverage pinned by an integration test on the MCP read path and a Playwright assertion on the detail-drawer Source row.
*Where:* `apps/dashboard/src/components/annotations/annotation-detail-sheet.tsx` (Source row), `apps/api/src/routes/internal/annotations.integration.test.ts` (MCP round-trip), `apps/dashboard/e2e/project-detail.spec.ts` (drawer assertion). Sourcemap-based recovery for production bundles tracked as A24; clickable editor jumps tracked as A25.

**G15. Animation pause / freeze toggle** — *S*
*Why:* Captures of mid-animation UIs are useless. Agentation freezes CSS, JS, and Web Animations API.
*What:* Toolbar toggle that injects `* { animation-play-state: paused !important; transition: none !important; }` and `document.getAnimations().forEach(a => a.pause())`. Resume on toggle off or when sidebar closes.
*Where:* `apps/extension/src/components/SidebarMoreMenu.tsx` (toggle), new `apps/extension/src/lib/animation-freeze.ts`.

**G16. Text-selection annotation mode** — *M*
*Why:* For copy / typo / wording feedback, selecting and quoting text is the natural action. Today users have to draw a rect around text.
*What:* New `targetType = "text"` (DB enum extension), capture `window.getSelection()` range + offset + selected string, render as a highlighted span overlay (similar to web annotators). Persist as `annotations.targetSelector` (XPath + offsets) and `domContext.selectedText`.
*Where:* `packages/db/src/schema.ts` (enum extension + migration), `apps/extension/src/lib/picker-controller.ts` (new mode), `apps/extension/src/lib/selector-generator.ts` (text-range selector strategy), dashboard detail sheet renderer.

**G17. Multi-element / batch select** — *M*
*Why:* "Make these three buttons match" is one feedback, not three. Today it's three annotations.
*What:* Modifier-key (Shift) extends current pick into a list. Resulting annotation has `targetSelector` as an array (or new `targetSelectors[]` field). Storage shape decision needed — easier path is "create N linked annotations with a `groupId`."
*Where:* `apps/extension/src/lib/picker-controller.ts`, schema decision in `packages/db/src/schema.ts` (groupId column on annotations).
*Open question:* groupId vs. array selectors — defer until G16 lands and we see how text-mode informs the shape.

**G18. Markdown export** — *S*
*Why:* Even without an agent integration, users want to copy a session's findings into a doc/issue. Agentation's tiered formats (Compact / Standard / Detailed / Forensic) are nice but overkill — start with one good format.
*What:* "Export as markdown" action in dashboard project view and extension sidebar. Render selector, comment, intent, severity, screenshot URL, ancestors, optional component tree.
*Where:* `apps/dashboard/src/app/app/projects/[slug]/_components/annotations-browser.tsx` (action), new `packages/shared/src/markdown-export.ts`.

**G19. Layout / wireframe mode** — *XL, P3, only if product direction warrants*
*Why:* Speculative. Agentation v3 added drag-65-components-onto-page. Could be a differentiator if Remarks expands toward design handoff. More likely: don't build until customer-pull is clear.
*What:* Defer. If pursued: requires `kind` enum (G5), a component palette (would consume `@remarks/ui`), placement coords on annotation, and a renderer in the dashboard.
*Where:* deferred.

### Dashboard (`apps/dashboard`)

**D1. Live activity feed (annotations panel) backed by SSE** — *S, depends on G9*
*Why:* Today annotation lists are static-until-refresh. With G9 in place, this is a thin client.
*What:* Add EventSource listener in `annotations-browser.tsx`; on event, optimistically merge into the React Query cache. Toast on new annotation.
*Where:* `apps/dashboard/src/app/app/projects/[slug]/_components/annotations-browser.tsx`.

**D2. Intent + severity badges and filters** — *S, depends on G1 + G2*
*Why:* Schema gain is wasted without UI affordance.
*What:* Extend `annotation-card.tsx` and `annotation-detail-sheet.tsx` with badges; extend status-tabs with intent/severity filters. New primitives: probably reuse `Badge` from `@remarks/ui`.
*Where:* `apps/dashboard/src/components/annotations/*`, `apps/extension/src/components/SidebarStatusTabs.tsx` (mirror).

**D3. "Pending" / "Awaiting agent" view** — *S, depends on G3*
*Why:* Triage by what hasn't been acknowledged.
*What:* New filter chip + view that shows `status IN ('to_do')` AND `no event of type 'agent_acknowledged' exists`. Implemented in the existing list query.
*Where:* `apps/dashboard/src/app/app/projects/[slug]/_components/annotations-panel.tsx`, `apps/api/src/routes/projects/[id]/annotations.ts` (new filter param).

**D4. Threaded conversation UI** — *M*
*Why:* Today comments render flat. Agent ↔ human turns deserve role-tagged styling and a "reply" affordance distinct from "add comment."
*What:* In the detail sheet, render `annotationEvents` of types `comment_added` / `agent_commented` / `agent_updated_status` as a chat-style transcript with role pills (human / agent / system). Add reply composer.
*Where:* `apps/dashboard/src/components/annotations/event-row.tsx`, `annotation-detail-sheet.tsx`.

**D5. Webhook settings UI** — *S, depends on G11*
*Why:* Without UI, webhooks are unusable.
*What:* See G11.

### Cross-cutting

**X1. Document the AFS-equivalent annotation schema** — *S, no deps* — **DONE 2026-04-30 (ADR-0016 in `docs/adr/0016-annotation-schema-v1.md`; canonical Zod in `packages/shared/src/schemas/annotation.ts`)**
*Why:* Once G1 / G2 / G3 ship, our annotation surface needs a single canonical doc (akin to AFS 1.1) so MCP clients and SDK users have one source of truth.
*What:* New ADR in `docs/adr/NNNN-annotation-schema-v1.md` and a Zod schema in `packages/shared/src/annotation-schema.ts` consumed by both API and extension.
*Where:* per CLAUDE.md §1.4 (Zod cross-boundary lives in `packages/shared`).

---

## Suggested phasing

**P0 — schema foundations (week 1).** G1 (intent), G2 (severity), G3 (acknowledged), G4 (dismiss reason), X1 (Zod schema doc). All small, all unblock multiple downstream specs. Single migration. **G1 + G2 + G3 + X1 shipped 2026-04-30 (migration 0007 + ADR-0016); G4 still pending.**

**P1 — agent loop wins (weeks 1–2).** G6 (acknowledge), G7 (dismiss with reason), G8 (get_pending), D2 (badges), D3 (pending view), D4 (threaded UI). High user-visible delta with low risk.

**P2 — real-time + integrations (weeks 2–4).** G9 (SSE), G10 (watch_annotations), G11 (webhooks), D1 (live feed), D5 (webhook UI). Bigger lift; biggest "feels modern" gain.

**P3 — capture richness (weeks 3–5, parallelizable).** G12 (computed styles confirm), G13 (Fiber tree, **shipped 2026-05-01 — ADR-0019**), G14 (source location, **shipped 2026-05-01 — folded into G13's per-component schema + dashboard Source row**), G15 (animation pause), G16 (text mode), G17 (multi-select), G18 (markdown export). Independent of P2; can be split across people.

**P4 — defer.** G5 (kind enum) + G19 (layout mode). Only if customer-pull appears.

---

## Verification plan when implementing

For each spec above, before reporting complete:
1. `pnpm turbo typecheck --filter="*"` — must pass
2. `pnpm turbo lint --filter="*"` — Biome clean
3. `pnpm turbo test --filter="*"` — unit
4. For schema (`G1`–`G5`, `G11`, `G16` migration, `G17` groupId) and any API change: integration tests under `apps/api/test/integration/`. Run with MinIO + dev DB per CLAUDE.md §1.11.
5. For dashboard UI specs (`D1`–`D5`): Playwright E2E + manual run of dev server, exercise the feature in Chrome.
6. For extension specs (`G12`–`G18`): WXT dev build + Playwright extension test + manual flow on at least one React app and one non-React site.
7. `pnpm turbo build --filter="*"` — final.

Also: each schema-affecting spec needs a new ADR per CLAUDE.md §1.7.

---

## Things to NOT borrow from agentation

- **`<Agentation />` React-component-in-app injection model.** Remarks is a browser extension by design; the in-app component model assumes you own the codebase, which is the opposite of our "annotate any site" value prop.
- **SQLite / in-memory storage.** We are SaaS; durability is a feature.
- **Stdio MCP.** We have OAuth-DCR-backed MCP and that's better.
- **PolyForm Shield licensing posture.** Out of scope.
- **Forensic / Detailed / Compact tiered output formats.** One good markdown format (G18) is enough until users ask for tiers.
- **Layout mode (G19) until product direction is clear.** Listed but P4.
