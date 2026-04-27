# Spec amendments — Phase 0-1

This document is the backlog for changes that don't fit cleanly as a numbered task in `remarks-phase-0-1-spec.md` §13/§14 but that need to happen. Each entry is an **independent unit of work** that can be picked up between numbered spec tasks — not just a note.

IDs are stable (`A1`, `A2`, …) so they can be referenced from PR titles and commits, e.g., `chore(spec): address A6 — update §10.2 testing language`. Closed entries stay in the file with updated `Status:` lines so the doc is a historical record.

Each entry uses this shape, deliberately task-like so it mirrors §13/§14 and can be handed to a Claude Code session the same way:

- **Lead-in table** — 3-column `| # | Done when | Complete |` table directly under the H2. Mirrors §13/§14 task tables at a glance: the `#` cell gets a trailing `✓` when the amendment is done; `Done when` is the highest-signal acceptance criterion as a single line; `Complete` is a GFM `[ ]`/`[x]` checkbox so reviewers can see open-vs-done without reading the Status bullet.
- **Spec reference** — line(s) in `docs/plan/remarks-phase-0-1-spec.md` or "not specified"
- **Problem** — what's broken, ambiguous, or missing
- **Proposed deliverable** — concrete change to code, spec, or docs. PR-description shape.
- **Done when** — one or two bullets, checklist-style. The table above condenses this to one line; this bullet carries the full checklist.
- **Conflicts / overlaps with spec** — stale or contradicted language
- **Affected tasks / components** — specific §13/§14 task numbers and file areas
- **Dependencies** — `after task X.Y` / `before task X.Y` / `independent`
- **Estimated size** — `xs` (<30m) / `s` (<2h) / `m` (<1d) / `l` (>1d)
- **Status** — `open` / `in progress (PR #NN)` / `done in task X.Y` / `deferred to phase N` / `rejected (see rationale)`

---

## A1 — Annotation list pagination UI on the project detail page

| # | Done when | Complete |
|---|---|---|
| A1 ✓ | Project with >100 annotations renders without silent data loss; chosen pattern documented in spec | [x] |

- **Spec reference**: §14 task 1.14 says only "Shows seeded data with screenshots"; no pagination task. §5.5 mandates cursor-based pagination server-side. `listAnnotationsQuerySchema` caps `limit` at 100.
- **Problem**: The Phase 1 API returns annotations in cursor-paginated pages, but no §14 task creates a client-side pagination or infinite-scroll UI. Any project that crosses 100 annotations silently truncates on the detail page.
- **Proposed deliverable**: Pick one and ship it:
  - (a) Document the 100-row ceiling in the detail-page empty-state / footer copy and defer pagination to Phase 2. Cheapest.
  - (b) "Load more" button that calls `annotations.list` with the returned `nextCursor` and appends results. Works because the ordering is `(createdAt DESC, id DESC)` — appended items always belong at the bottom of whichever branch group they land in.
  - (c) Server-side grouping: new procedure `annotations.listGroupedByBranch({ projectId, perBranchLimit })` returning `{ branches: [{ name, items, nextCursor }] }`. Each branch paginates independently.
- **Done when**:
  - Either (a), (b), or (c) is shipped and documented in the spec
  - A project with >100 annotations renders without silent data loss in the dashboard
- **Conflicts / overlaps with spec**: No direct contradiction. The spec implicitly assumes paginated display since the API enforces it; §14's omission is the gap.
- **Affected tasks / components**:
  - Task 1.29 (extension sidebar thread view) — same gap; the chosen pattern should inform that
  - Task 1.18 (polling every 5s) — refetch strategy depends on pagination choice
  - Any future annotation filter UI
- **Dependencies**: Independent. Worth resolving before 1.29.
- **Estimated size**: `s` for (a), `m` for (b), `l` for (c).
- **Status**: `done in task 1.14 — option (b)`. `useInfiniteQuery` + "Load more" button on the project detail page; per-page size 50; branch grouping stays client-side. Same pattern is now the reference for task 1.29 (extension sidebar).

## A2 — Dev seed script referenced in §2 but no task creates it

| # | Done when | Complete |
|---|---|---|
| A2 ✓ | `pnpm seed` is idempotent and populates ≥3 branches + ≥8 annotations covering all 4 statuses | [x] |

- **Spec reference**: §2 (monorepo tree listing for `tools/scripts/seed.ts`); §14 task 1.14 ("Shows seeded data with screenshots").
- **Problem**: The spec tree shows `tools/scripts/seed.ts` but no §13 or §14 task creates it. Task 1.14's done-when depends on seeded data existing and — without the extension, which doesn't ship until weeks 8–11 — there's no way to produce any.
- **Proposed deliverable**: Idempotent script that populates an org/user/project/branches/annotations and uploads a placeholder screenshot to R2. Accepts real Clerk org + user IDs via `DEV_SEED_CLERK_ORG_ID` and `DEV_SEED_CLERK_USER_ID` since Clerk owns auth identity per §3.1. Wired behind `pnpm seed` at repo root. Requires `tools/*` added to `pnpm-workspace.yaml` so the new `@remarks/scripts` package can resolve `@remarks/db`.
- **Done when**:
  - `pnpm seed` run twice in a row produces the same DB state (idempotent)
  - Seed populates ≥3 branches and ≥8 annotations mixing all 4 statuses
  - At least one annotation has an `annotationAssets` row with a real R2 object when R2 env is present
  - Script prints a clear error and exits 1 if `DEV_SEED_CLERK_ORG_ID` or `DEV_SEED_CLERK_USER_ID` is missing
- **Conflicts / overlaps with spec**: None.
- **Affected tasks / components**: Tasks 1.15, 1.16, 1.17, 1.18, 1.19, 1.20, 1.33, 1.34 — every dashboard task before the extension ships.
- **Dependencies**: Independent. Blocks manual verification of dashboard-only tasks.
- **Estimated size**: `m`.
- **Status**: `done in task 1.14`.

## A3 — Project fetch by slug is not in the REST API

| # | Done when | Complete |
|---|---|---|
| A3 ✓ | §5.2 documents `projects.getBySlug({ orgId, slug })` with Clerk org-scoping | [x] |

- **Spec reference**: §5.2 endpoint table; §7.2 route structure.
- **Problem**: §5.2 lists only `GET /projects/:projectId` (UUID). The dashboard route convention is `/app/projects/:slug` (§7.2), so something has to resolve slug → id. Nothing did before task 1.14.
- **Proposed deliverable**: Choose one and update the spec to match:
  - (a) Add REST `GET /orgs/:orgId/projects/by-slug/:slug` to §5.2 as well (the extension will want slug-addressable projects too when the branch picker goes live, so having it in both REST and tRPC keeps shape parity).
  - (b) Keep it tRPC-only: `projects.getBySlug({ orgId, slug })` — dashboard only (what task 1.14 actually shipped).
- **Done when**:
  - §5.2 (or a new §5 subsection for tRPC) lists the new endpoint/procedure signature
  - Slug resolution is scoped by `clerkOrgId` so non-members don't learn project existence (matches the unique index in §3.2 `projects_org_slug_idx`)
- **Conflicts / overlaps with spec**: None, but §5.2 is currently silent on slug resolution.
- **Affected tasks / components**:
  - Task 1.14 (landed via option b)
  - Task 1.32 (project settings: delete, rename — also slug-addressable routes)
  - Task 1.15 (annotation detail — likely `/app/projects/:slug/annotations/:annotationId`, reuses the same resolver)
- **Dependencies**: Independent. Code path exists; amendment is the spec update.
- **Estimated size**: `xs` if we stay with (b) (spec edit only); `s` if we also add the REST form for symmetry.
- **Status**: `done` — spec follow-up to task 1.14. Option (b) ratified by the "tRPC slug resolution" note appended to §5.2. A full tRPC procedure enumeration + Context shape is deferred to A4.

## A4 — tRPC Context shape is underspecified

| # | Done when | Complete |
|---|---|---|
| A4 ✓ | §5 (or §7.3) pins a canonical tRPC Context shape and `apps/api/src/trpc/trpc.ts` matches | [x] |

- **Spec reference**: §7.3 (dashboard tRPC); §5 generally (no tRPC context mention).
- **Problem**: §7.3 shows dashboard-side tRPC setup but never specifies what lives in the server-side Context. Task 1.14 added `r2` because `annotations.list` presigns assets. Future tRPC rate limiting would want `redis`. Without a canonical definition, every new procedure re-decides.
- **Proposed deliverable**: Add a short subsection — either §5 (between §5.2 and §5.5) or near §7.3 — fixing the Phase 1 tRPC Context shape: `{ db, user?, orgMemberships, r2, requestId }`. Include a one-line note that rate-limiting at the tRPC layer is explicitly out of scope for Phase 1 (the §5.6 middleware stays Fastify-only and tRPC requests bypass it by design).
- **Done when**:
  - Spec has one canonical Context definition
  - `apps/api/src/trpc/trpc.ts` matches the documented shape
- **Conflicts / overlaps with spec**: §5.6's rate-limit middleware is Fastify-hook only, so tRPC mutations currently don't rate-limit. That's a distinct, intentional Phase 1 choice worth calling out in the same edit.
- **Affected tasks / components**: Every tRPC procedure that needs presigned URLs or will need rate limiting in the future.
- **Dependencies**: Independent.
- **Estimated size**: `xs` (spec edit only — code is already in place from task 1.14).
- **Status**: `done` — spec edit landed as new §5.7 "tRPC surface (dashboard only)"; the §5.2 A3-era pointer to this entry was rewritten to reference §5.7 instead. `apps/api/src/trpc/trpc.ts` already matched the canonical shape since task 1.14, so no code change was needed.

## A5 — Authorization helpers are Fastify-coupled

| # | Done when | Complete |
|---|---|---|
| A5 ✓ | Pure `assertProjectMember` used by tRPC; Fastify `requireProjectMember` wraps it with integration tests still green | [x] |

- **Spec reference**: Not specified.
- **Problem**: `requireProjectMember` in `apps/api/src/lib/authorization.ts` originally took a `FastifyRequest`. tRPC procedures have no request object, which would have forced either faking one or duplicating logic.
- **Proposed deliverable**: Extract a pure `assertProjectMember(db, userId, projectId, opts?)` and keep the Fastify `requireProjectMember` as a thin adapter calling it. Same pattern for any future request-coupled helper.
- **Done when**:
  - All tRPC procedures that enforce project roles use the pure helper
  - The Fastify wrapper still passes existing integration tests unchanged
- **Conflicts / overlaps with spec**: None.
- **Affected tasks / components**: Task 1.16 (status update mutation), 1.32 (settings mutations), 1.33 (invitations, if done via tRPC).
- **Dependencies**: Independent. Implemented in 1.14 as a precondition for `annotations.list`.
- **Estimated size**: `s`.
- **Status**: `done in task 1.14` (PR #21, commit `769b475`). Pure `assertProjectMember(db, userId, projectId, opts?)` lives in `apps/api/src/lib/project-authorization.ts`; `apps/api/src/lib/authorization.ts` re-exports it and keeps the Fastify `requireProjectMember(request, projectId, opts?)` adapter. The two-file split keeps Fastify type augmentations (`request.auth`, `fastify.db`) out of the tRPC import graph — the dashboard's type-only `AppRouter` import would otherwise pull them in. All four `annotations.*` tRPC procedures (`list`, `get`, `listEvents`, `update`) call the pure helper; Fastify routes under `apps/api/src/routes/{annotations,projects,uploads}` keep using the adapter unchanged. §5.7's "Adding a new procedure" paragraph already cites `assertProjectMember` as the canonical pattern, so the cross-link runs both ways.

## A6 — Spec §10.2 still says Testcontainers; repo uses a Postgres service container

| # | Done when | Complete |
|---|---|---|
| A6 ✓ | §10.2 no longer mentions Testcontainers and describes the GitHub Actions service-container setup per CLAUDE.md §1.5 | [x] |

- **Spec reference**: spec §10.2; CLAUDE.md §1.5.
- **Problem**: §10.2 describes "Vitest + Testcontainers for ephemeral Postgres". CLAUDE.md §1.5 is the authoritative account: GitHub Actions service container in CI; local Postgres 16 via `DATABASE_URL`; `fileParallelism: false`; `TRUNCATE ... RESTART IDENTITY CASCADE` between tests. The spec paragraph is stale.
- **Proposed deliverable**: Replace the §10.2 Testcontainers paragraph with language matching CLAUDE.md §1.5. Add a one-line pointer: "Integration-test infrastructure authoritative in `CLAUDE.md` §1.5."
- **Done when**:
  - §10.2 no longer mentions Testcontainers
  - §10.2 describes the service-container setup, `fileParallelism: false`, and the `TRUNCATE ... RESTART IDENTITY CASCADE` teardown
- **Conflicts / overlaps with spec**: Direct contradiction. CLAUDE.md wins per §1 ("treat as binding"), so the spec is the one to update.
- **Affected tasks / components**: All integration tests; no Phase 1 task is currently blocked.
- **Dependencies**: Independent. Natural to bundle into whichever PR next touches integration-test infra.
- **Estimated size**: `xs`.
- **Status**: `done` — spec edit only. §10.2 rewritten against CLAUDE.md §1.5 (Postgres 16 via `DATABASE_URL`, shared harness, migrate-once + `TRUNCATE ... RESTART IDENTITY CASCADE` between tests, `fileParallelism: false`, GitHub Actions service container in CI) and ends with the authoritative pointer. The stale Testcontainers mention at spec line 77 (spec's own §1.5 "Testing rules") was the same problem and was bundled into this amendment so the spec stays internally consistent. ADR 0004 (`docs/adr/0004-neon-postgres-and-drizzle.md`) still references Testcontainers and was deliberately left alone per CLAUDE.md §1.10 — ADRs are historical by design, and its Testcontainers reference accurately captures the plan at decision time. **Testcontainers was reconsidered before closing and rejected**: its real win is per-file DB isolation enabling `fileParallelism: true`, but container startup (~3–5s per file) loses to the current TRUNCATE-between-tests model (microseconds per reset) at Phase-1 suite size. Secondary wins (zero-config local testing, removing the `services:` block in `ci.yml`) are marginal and don't justify a new runtime dep (CLAUDE.md §1.10), Docker-in-Docker complexity on Apple Silicon, or a superseding ADR to 0004. Revisit if the integration suite exceeds ~30s or a second engineer joins and onboarding friction shows up.

## A7 — Dashboard loading skeletons via in-page Suspense (deferred from task 1.20)

| # | Done when | Complete |
|---|---|---|
| A7 ✓ | Both projects pages stream slow parts behind `<Suspense>`; no new `loading.tsx`; 404 e2e still passes | [x] |

- **Spec reference**: §14 task 1.20 ("Error boundaries and loading states across the app").
- **Problem**: Task 1.20 was meant to add `loading.tsx` skeletons alongside the error boundaries. Every Next.js App Router `loading.tsx` placement that wraps a page calling `notFound()` flushes the response with HTTP 200 before the page resolves to 404 — the status is locked once streaming begins. The 404 status assertion in `e2e/project-detail.spec.ts` ("unknown slug renders the 404 not-found page") regresses for any `loading.tsx` placed at `projects/`, `projects/[slug]/`, or higher. See [vercel/next.js#76474](https://github.com/vercel/next.js/issues/76474), [#45801](https://github.com/vercel/next.js/issues/45801). Task 1.20 shipped the error.tsx half and explicitly omitted loading.tsx.
- **Proposed deliverable**: In each data-fetching page, do the early validation step (`projects.getBySlug`, `projects.list`) inline so any `notFound()` runs before streaming. Then wrap the slow part — the annotation list on `[slug]/page.tsx`, the project rows on `projects/page.tsx` — in `<Suspense fallback={<Skeleton />}>` around a child server component that does the second fetch. Skeleton components stay inline (no new `packages/ui` primitives), matching task 1.19's empty-state pattern.
- **Done when**:
  - `apps/dashboard/src/app/app/projects/page.tsx` renders the header immediately and streams the project list behind a Suspense skeleton
  - `apps/dashboard/src/app/app/projects/[slug]/page.tsx` renders the project header immediately (after `getBySlug` resolves) and streams the annotations list behind a Suspense skeleton
  - The existing e2e 404 status assertion still passes (`pnpm --filter @remarks/dashboard test:e2e -g "unknown slug"`)
  - No new `loading.tsx` files are added
- **Conflicts / overlaps with spec**: None. Task 1.20's "loading states" deliverable is fulfilled by this amendment.
- **Affected tasks / components**: `apps/dashboard/src/app/app/projects/page.tsx`, `apps/dashboard/src/app/app/projects/[slug]/page.tsx`, plus a new child server component per page.
- **Dependencies**: `after task 1.20` (PR #27 shipped error.tsx + this gap).
- **Estimated size**: `s`.
- **Status**: `done` — spec follow-up to task 1.20. Inline `<Suspense>` wraps `<ProjectList>` on `projects/page.tsx` and `<AnnotationsPanel>` on `[slug]/page.tsx`; the validating `projects.getBySlug` fetch stays inline in the detail page so `notFound()` runs pre-stream and the e2e 404 assertion (`project-detail.spec.ts:24`) still passes. No `loading.tsx` added and no new `packages/ui` primitive — skeletons live inline under route-private `_components/` folders with `animate-pulse` + `bg-muted`. The two Next.js issue links in this entry were re-verified against upstream discussions (#76501 confirmed WONTFIX) before landing, and the inline-Suspense pattern is the community-standard workaround — a middleware rewrite was rejected as overkill for a problem the in-page split already solves.

## A8 — Clerk syncHost for extension-to-dashboard session sharing

| # | Done when | Complete |
|---|---|---|
| A8 ✓ | Signing into `localhost:3000` results in the popup being signed in; prod allowlist documented for re-run | [x] |

- **Spec reference**: §6.2 (extension popup), §14 task 1.21 (Clerk popup sign-in).
- **Problem**: Task 1.21 wired standalone sign-in in the popup, but the Phase 1 UX story assumes a user who's already signed into the dashboard shouldn't have to sign in separately in the extension. Clerk's Chrome Extension SDK supports this via `syncHost`, but it requires (a) a stable `chrome-extension://<id>` origin via a committed `manifest.key` public key, (b) that exact origin in Clerk's `allowed_origins` allowlist, and (c) host_permissions for the dashboard URL. Task 1.21's plan deferred this as "separate amendment if beta users ask" — doing it in the same branch keeps the extension UX coherent.
- **Proposed deliverable**:
  - Commit a DER-encoded RSA public key to `apps/extension/wxt.config.ts` (`CRX_PUBLIC_KEY`), pinning the extension ID to `baikikfefeheiildmfoaicbjbnbecgjd` across all clones.
  - Add `https://app.remarks.online/*` to `host_permissions`.
  - Wire `ClerkProvider syncHost={env.WXT_CLERK_SYNC_HOST}` with a new env var (dev default `http://localhost:3000`, prod `https://app.remarks.online`).
  - New idempotent script `tools/scripts/clerk-allowlist-extension.ts` that merges `chrome-extension://<id>` into Clerk `/v1/instance` `allowed_origins` via Backend API (no dashboard clicking).
  - New runbook `docs/runbooks/extension-clerk-synchost.md` covering one-time keypair generation, dev vs prod allowlist flow, and the Chrome Web Store ID caveat.
- **Done when**:
  - Dev instance's `allowed_origins` contains `chrome-extension://baikikfefeheiildmfoaicbjbnbecgjd` (ran `clerk-allowlist-extension.ts` — confirmed)
  - Extension built, loaded unpacked at the expected ID, popup picks up session from signed-in dashboard at `localhost:3000`
  - Runbook documents the prod re-run with the `sk_live_` key and the Web-Store-ID reassignment step
- **Conflicts / overlaps with spec**: None. Extends §6 extension architecture without contradicting it.
- **Affected tasks / components**:
  - Task 1.21 (shipped in the same PR as the syncHost wiring)
  - Task 1.22+ (project picker, API calls) — will consume the synced session via `@clerk/chrome-extension`'s `useAuth`
- **Dependencies**: `in task 1.21` (bundled).
- **Estimated size**: `m`.
- **Status**: `done in task 1.21` — dev Clerk `allowed_origins` now `["chrome-extension://baikikfefeheiildmfoaicbjbnbecgjd"]` (verified via PATCH response). Prod run deferred to the production deploy milestone, with the runbook as the handoff.

## A10 — Full Clerk session inside the sidebar shadow root

| # | Done when | Complete |
|---|---|---|
| A10 ✓ | Sidebar can make Bearer-authenticated tRPC calls without embedding `ClerkProvider`; active org id surfaced to content script | [x] |

- **Spec reference**: §6 extension architecture; §14 task 1.25 (sidebar UI), task 1.27 (create annotation flow), task 1.29 (sidebar thread view).
- **Problem**: Task 1.25 shipped the sidebar UI shell built on shadcn + Tailwind inside a closed shadow DOM. The shell needs to know whether the user is signed in (to show the right empty state) but not the full Clerk session, so 1.25 avoided embedding `ClerkProvider` in the content script. Instead, a background handler reads the `__session` cookie on `WXT_CLERK_SYNC_HOST` and replies to `{ kind: "auth-status" }` requests, with `chrome.cookies.onChanged` pushing updates to every tab. That's enough for the sidebar's signed-in dot and the signed-out / no-project CTAs. Tasks 1.27 (create annotation) and 1.29 (tRPC-backed thread list) need a real Bearer token from Clerk, and the current shape can't supply one without running a `ClerkProvider` somewhere.
- **Proposed deliverable**: Choose one and ship it:
  - (a) Embed `@clerk/chrome-extension`'s `ClerkProvider` + `syncHost` inside the content-script React tree. Requires solving: Clerk SDK's internal iframe injection against host-page CSP (github.com, banks, admin consoles typically block third-party iframes); key-rotation / token-refresh running in a page context we don't fully control; making the SDK Portal-aware (its UI components portal to `document.body`, which leaks).
  - (b) Keep Clerk confined to the popup/service-worker. Background worker brokers authenticated API calls on the content script's behalf: content script sends `{ kind: "trpc-call", path, input }`; background uses the popup's stored Clerk session to attach the Bearer header and returns the tRPC response. Heavier wire format but bounds Clerk to one document.
  - (c) Hybrid: sidebar uses `chrome.cookies.get` + a background message that returns a short-lived Clerk JWT, content script uses that token directly with its own tRPC client.
  - (d) **Chosen (and landed).** Run Clerk's headless client directly inside the MV3 service worker via `createClerkClient({ publishableKey, syncHost, background: true })` from `@clerk/chrome-extension/client`. This is the SDK's sanctioned path for background contexts (shipped in Chrome Extension SDK 2.0, Nov 2024). The sidebar asks the background for a token; the background calls `clerk.session.getToken()` which refreshes on demand (60s default per the [force-token-refresh guide](https://clerk.com/docs/guides/sessions/force-token-refresh)). Session state persists to `chrome.storage`, shared with the popup's `ClerkProvider`. No offscreen document, no cookie reading.
- **Done when**:
  - Sidebar can render a tRPC-backed `annotations.list` query without requiring the popup to be open
  - Signed-in dot, auth CTAs, and token refresh all work across reloads, tab switches, and sign-in/out events
  - Decision documented here (and a short design note under `docs/runbooks/` or in §6 of the spec, whichever matches)
- **Conflicts / overlaps with spec**: §6.2 says the extension "uses Clerk's Chrome extension SDK to get a JWT"; that's true for the popup today but not the content script. Resolving this amendment reconciles §6.2 across both surfaces.
- **Affected tasks / components**: Task 1.27 (upload flow needs a Bearer), task 1.29 (real sidebar thread list), task 1.30 (branch selector reads/writes projects). `apps/extension/src/lib/trpc.ts`, `apps/extension/src/lib/auth-status.ts`, `apps/extension/src/entrypoints/background.ts`.
- **Dependencies**: `before task 1.27` (submit flow needs auth). Independent of A11+.
- **Estimated size**: `l`.
- **Status**: `done in task 1.25` via option (d). Journey: we briefly shipped option (c) (raw cookie reads), then tried a Chrome offscreen document hosting `<ClerkProvider>` to solve cookie staleness, then deep-dove Clerk's docs and found `createClerkClient({ background: true })` — the officially-supported path that eliminates both the cookie-read and the offscreen document. Final shape:
  - `apps/extension/src/entrypoints/background.ts` calls `createClerkClient({ publishableKey, syncHost, background: true })` lazily on first message. The `auth-status` handler returns `signedIn` (from `clerk.session != null`), `token` (from `clerk.session.getToken()`), and `clerkOrgId` (read from `local:remarks.activeClerkOrgId`, written by the popup's `<ActiveOrgSync />`). `clerk.addListener` pushes `auth-status-changed` to every tab whenever Clerk state moves (sign-in, sign-out, token refresh, org switch).
  - Active org id surfaced via `apps/extension/src/lib/active-org.ts` (storage key `local:remarks.activeClerkOrgId`). Popup's `<ActiveOrgSync />` writes it when `useOrganization()` resolves. Background `watchActiveClerkOrgId` re-broadcasts on change. **Follow-up worth considering**: Clerk's default session token v2 (April 2025) now includes `o.id` (active org) as a first-class claim. API server-side could extract it from `verifyToken(token).payload.o.id` and drop the `chrome.storage.local` broadcast — cleaner and removes the popup-open-at-least-once dependency. Parked as a potential future amendment; not blocking.
  - `apps/extension/src/lib/sidebar-trpc-provider.tsx` consumes `useAuthStatus().token` as the Bearer, re-materializing the tRPC client when the token changes.
  - `wxt.config.ts` manifest permissions: `["storage", "activeTab", "tabs", "scripting", "cookies"]`. `offscreen` dropped after the offscreen experiment was removed. `cookies` stays because `@clerk/chrome-extension`'s background client throws `Missing 'permissions.cookies' entry in manifest.json` at first `getToken()` call without it — caught by the Playwright verify suite (see `apps/extension/verify/`).
  - **Firefox**: `createClerkClient({ background: true })` works in Firefox MV2 service workers too (same chrome.storage-based persistence via `webextension-polyfill`), so the previous Firefox staleness caveat is also gone.
  - **Known limitation**: Clerk has a documented "side panel needs reopen after web auth" bug ([syncHost guide](https://clerk.com/docs/guides/sessions/sync-host)) — if the user signs in/out on the dashboard while the sidebar is open in another tab, state may lag until `clerk.addListener` fires (typically quick via chrome.storage broadcast, but worth knowing). Not blocking Phase 1.

## A11 — `authorizedParties` missing from Clerk `verifyToken`

| # | Done when | Complete |
|---|---|---|
| A11 | `apps/api/src/plugins/auth.ts` passes `authorizedParties` to `verifyToken`; integration tests still pass | [ ] |

- **Spec reference**: Not explicitly in the spec; surfaced by Clerk's [`verifyToken` reference](https://clerk.com/docs/reference/backend/verify-token) and [Manual JWT verification guide](https://clerk.com/docs/guides/sessions/manual-jwt-verification), which call `authorizedParties` out as a mitigation for a "subdomain cookie leaking attack."
- **Problem**: `apps/api/src/plugins/auth.ts` today calls `verifyToken(token, { secretKey: env.CLERK_SECRET_KEY })` without `authorizedParties`. Clerk's docs treat the missing allowlist as a security gap: a token legitimately minted for some other application on a Clerk subdomain could be replayed against our API. Phase 1's blast radius is low (single Clerk instance, internal beta users), but this is the kind of thing that bites the moment you add a second hosted front-end.
- **Proposed deliverable**:
  - Add `CLERK_AUTHORIZED_PARTIES` to `apps/api/src/env.ts` as a comma-separated `z.string()` → `.transform(s => s.split(",").map(p => p.trim()))`. Required in all environments. Example dev value: `http://localhost:3000,chrome-extension://baikikfefeheiildmfoaicbjbnbecgjd`. Example prod: `https://app.remarks.online,chrome-extension://baikikfefeheiildmfoaicbjbnbecgjd`.
  - Update `apps/api/src/plugins/auth.ts` to pass `authorizedParties` into `verifyToken`.
  - Extend the `.env.example` and deploy runbook so Vercel/Fly configs set it.
  - Integration test: a token whose `azp` isn't in the list is rejected; tokens whose `azp` matches pass.
- **Done when**:
  - `verifyToken` is called with `authorizedParties` in every environment
  - Env schema rejects missing `CLERK_AUTHORIZED_PARTIES`
  - Integration test covers the reject path
- **Conflicts / overlaps with spec**: §12 ("Security baseline") says "Clerk handles password hashing, session management, email verification. You don't touch any of it." True for the primitives, but `authorizedParties` is a *caller-side* mitigation the spec didn't call out.
- **Affected tasks / components**: `apps/api/src/plugins/auth.ts`, `apps/api/src/env.ts`, `.env.example` for apps/api, deploy runbooks under `docs/runbooks/`.
- **Dependencies**: Independent. Cheap to fold into the next API PR.
- **Estimated size**: `s`.
- **Status**: `open`.

## A9 — Drop Drawbridge-era names from spec §6

| # | Done when | Complete |
|---|---|---|
| A9 ✓ | Spec §6 no longer references "Moat" or the `.db-` CSS prefix; extension code matches | [x] |

- **Spec reference**: §6.2 lines 1258–1259; §6.4 line 1281; §6.8 line 1310.
- **Problem**: Drawbridge is the predecessor product; the Phase 0-1 spec copy-carried three Drawbridge-era names into §6. "Moat" was Drawbridge's internal nickname for the injected sidebar, and `.db-` (Drawbridge) was its CSS-scope prefix. Both leak through in the spec even though no Remarks code has ever used the word "Moat". Leaving them makes the spec confusing for new readers and anchors new task plans (1.23–1.31) to names that have no referent in the actual product.
- **Proposed deliverable**:
  - §6.2 line 1258: "Runs the Moat sidebar, element picker, rectangle drawer" → "Runs the Remarks panel, element picker, rectangle drawer."
  - §6.2 line 1259: `"Open Moat"` button → `"Open Remarks panel"` button.
  - §6.4 line 1281: "All styles prefixed with `.db-`" → "All styles prefixed with `.rmk-`."
  - §6.8 line 1310: `"moat-watcher"` → `"file-watcher"`.
  - Rename extension CSS prefix in `apps/extension/src/styles/content.css` (4 classes) + `apps/extension/src/components/SidebarShell.tsx` (3 `className` refs) from `.db-*` to `.rmk-*`. All new picker classes (task 1.23) already use `.rmk-`.
- **Done when**:
  - Spec §6.2 / §6.4 / §6.8 no longer mention "Moat" or `.db-`
  - `rg "\.db-|Moat" apps/extension/src docs/plan/remarks-phase-0-1-spec.md` returns empty (besides this amendment entry, which is the rename's historical record)
  - Extension builds, lints, and tests stay green
- **Conflicts / overlaps with spec**: None — this is the spec edit itself.
- **Affected tasks / components**: Task 1.23 bundles this; tasks 1.24–1.31 inherit the new naming.
- **Dependencies**: `in task 1.23` (bundled).
- **Estimated size**: `xs`.
- **Status**: `done in task 1.23` — CSS rename + spec edits landed in the element-picker PR.

## A12 — `listAnnotations` is missing the URL filter required by §14 task 1.29

| # | Done when | Complete |
|---|---|---|
| A12 ✓ | `listAnnotationsQuerySchema` accepts an optional `url` filter and the service uses it | [x] |

- **Spec reference**: §5.2 / §5.5 / `listAnnotationsQuerySchema` (cursor + limit + status + branch only); §14 task 1.29 ("list of annotations for current URL/branch").
- **Problem**: The Phase 1 list endpoint accepts `status` and `branch` filters but not `url`. Task 1.29 (sidebar thread view) is scoped per §6.4 to the page the user is currently looking at, so the sidebar needs to ask the API "give me the annotations for *this* `href`." Without a URL filter the sidebar would have to fetch every annotation on the project's branch and filter client-side, breaking pagination and leaking unrelated comments.
- **Proposed deliverable**:
  - Add `url: z.string().url().optional()` to `listAnnotationsQuerySchema` in `packages/shared/src/schemas/annotation.ts`. Both REST and tRPC consume the same schema, so both surfaces get the filter.
  - Extend the `where` chain in `apps/api/src/services/annotation.service.ts` (`listAnnotations`) with `query.url ? eq(schema.annotations.url, query.url) : undefined`. Exact-href match — captured at annotation-creation time, so the comparison is symmetrical.
  - Integration tests in `apps/api/src/routes/annotations/list.integration.test.ts`: URL match, URL with no matches, and combined `status + branch + url`.
- **Done when**:
  - Schema accepts `url`
  - Service filters by exact match
  - Integration tests cover the new filter
- **Conflicts / overlaps with spec**: None — additive. §5.2's table doesn't enumerate query params per route; §5.5's pagination example is illustrative.
- **Affected tasks / components**: Task 1.29 (extension sidebar thread view) consumes the filter directly.
- **Dependencies**: Independent. Bundled into task 1.29.
- **Estimated size**: `xs`.
- **Status**: `done in task 1.29`.

## A14 — `ProjectResponse.myRole` for in-page admin gating

| # | Done when | Complete |
|---|---|---|
| A14 ✓ | `projects.getBySlug` (and any other surface a settings page consumes) returns the caller's project_members.role; settings UI gates destructive actions on it | [x] |

- **Spec reference**: §3.6 (project_members + roles); §5.2 ("User (project admin)" on PATCH/DELETE); §14 task 1.32 (settings page).
- **Problem**: Task 1.32 ships a settings page that any project member can land on, but only project admins can rename or delete. The current `ProjectResponse` (`packages/shared/src/schemas/project.ts`) doesn't include the caller's role, so the dashboard can't render the form differently for editors/viewers. The mutations enforce the check correctly (FORBIDDEN from `assertProjectMember(..., { minRole: "admin" })`) and the form surfaces "Only project admins can edit settings" inline on the failed click — but the buttons are visible and enabled by default, which is a small but real UX papercut.
- **Proposed deliverable**:
  - Extend `projectResponseSchema` (or a sibling `projectDetailResponseSchema`) with `myRole: projectRoleSchema`. Read it from `project_members` joined on the caller's `userId` inside `getProjectBySlug` (and `getProjectById` if the REST surface needs it).
  - Settings page: when `myRole !== "admin"`, render the form read-only (or disabled) with a "Only project admins can edit settings" banner, and hide the danger-zone delete card entirely.
  - Mutations stay authoritative — server still enforces.
- **Done when**:
  - `ProjectResponse` includes `myRole`
  - Settings page disables save + hides delete card for non-admin viewers
  - Detail-page header could optionally hide the Settings link for viewers (cheap follow-up)
- **Conflicts / overlaps with spec**: None — additive.
- **Affected tasks / components**: Task 1.32 (UX nicety), task 1.16 (could use the same hint to gate annotation status changes if author check is removed), task 1.33 (invitations could surface "you're an editor" in UI).
- **Dependencies**: `after task 1.32` (which lands the page that needs this).
- **Estimated size**: `s`.
- **Status**: `done` — bundled into the task 1.32 PR. Shape landed as `myRole: projectRoleSchema.nullable()` on `projectResponseSchema` (null = caller is org member but not a project member). All four read paths (`projects.list`, `projects.getBySlug`, `getProjectById` REST, `listProjectsByOrg` REST) were threaded with `callerUserId` and use a LEFT JOIN on `project_members`. Mutations (`update`, `create`) populate it from the asserted role rather than re-querying. Dashboard `EditProjectForm` disables inputs + shows a role-aware banner when `myRole !== "admin"`; `DeleteProjectForm` is conditionally rendered so non-admins never see the danger zone. Settings link in the detail header was left visible to all org members per the entry's "cheap follow-up" framing — viewers landing on settings see an inline explanation. Server enforcement (`assertProjectMember(..., { minRole: "admin" })`) stays the source of truth.

## A13 — Production database schema is never applied; no migrate step in deploy pipeline

| # | Done when | Complete |
|---|---|---|
| A13 ✓ | `deploy-api.yml` applies pending Drizzle migrations against the prod direct endpoint before `flyctl deploy`; current prod DB seeded; runbook documents the wiring | [x] |

- **Spec reference**: §9 (deployment); ADR 0004 (`docs/adr/0004-neon-postgres-and-drizzle.md`) says migrations "are applied with `drizzle-kit migrate`" but doesn't say where/when on prod.
- **Problem**: Neon prod (`main` branch) has zero application tables — the four migrations in `packages/db/drizzle/` (`0000`–`0003`) have never been applied to it. Root cause: nothing in the path from `git push origin main` → running prod app ever invokes `db:migrate`. `apps/api/src/index.ts` doesn't call `migrate()` on boot (intentional, §9.4); `apps/api/fly.toml` has no `[deploy] release_command`; `.github/workflows/deploy-api.yml` runs only `check-fly-secrets` → `flyctl deploy`. The dashboard on Vercel and the API on Fly both connect to that empty DB and silently 500 on schema-dependent endpoints. Compounding wrinkle: the runtime `DATABASE_URL` Fly secret is Neon's pooled (pgbouncer) endpoint, which can't run DDL — migrations have to use the direct endpoint, so the migrator can't reuse the Fly secret as-is.
- **Proposed deliverable**:
  - Add a `pnpm --filter @remarks/db db:migrate` step to `.github/workflows/deploy-api.yml`, gated **before** `flyctl deploy`, with `DATABASE_URL` populated from a new GitHub Actions repo secret `PROD_DATABASE_URL` (Neon `main` direct endpoint).
  - Add `PROD_DATABASE_URL` to the repo's GitHub Actions secrets pre-merge so the first run on `main` doesn't fail.
  - One-time bootstrap of the current empty prod DB: from a workstation, `DATABASE_URL='<prod direct url>' pnpm --filter @remarks/db db:migrate` (or let the first post-merge workflow run do it).
  - Document the wiring in `docs/runbooks/environments.md` under the "Production" section: where prod migrations run, which secret they use, and how to apply manually in an incident.
  - Rejected alternatives: Fly `release_command` (would need migration files copied into the runtime image and a separate Fly secret for the direct URL — heavier for no benefit while all prod deploys go through Actions); auto-migrating from API boot (excluded by spec §9.4 and races with multi-machine deploys).
- **Done when**:
  - `.github/workflows/deploy-api.yml` runs `db:migrate` against `secrets.PROD_DATABASE_URL` ahead of `flyctl deploy`
  - `PROD_DATABASE_URL` GitHub Actions secret is set to Neon `main` direct endpoint
  - Current prod DB has all four migrations applied (`__drizzle_migrations` populated; `\dt` returns the application tables)
  - `docs/runbooks/environments.md` documents the migrate-on-deploy wiring under the prod tier
  - A subsequent deploy run shows the migrate step as "No migrations to apply" (idempotent)
- **Conflicts / overlaps with spec**: None directly. §9 doesn't pin a migration trigger; ADR 0004 is silent on the production runner. Folding the trigger into the deploy workflow doesn't contradict either.
- **Affected tasks / components**: `.github/workflows/deploy-api.yml`; `docs/runbooks/environments.md`; the prod Neon `main` branch state; indirectly every dashboard/API surface that 500s today against the empty schema.
- **Dependencies**: Independent. Should be picked up immediately — Phase 1 prod is currently broken on any schema-dependent path.
- **Estimated size**: `s`.
- **Status**: `done` — workflow change landed in PR #50 (commit `d74b1b1`). Bootstrap was run from a workstation against the Neon `main` direct endpoint before merge, so the first post-merge `Deploy API` workflow run hit the migrate step as a no-op and proceeded into `flyctl deploy` cleanly. Subsequent deploys will pick up new migrations automatically as they're added under `packages/db/drizzle/`.

## A15 — `project_members` auto-sync from Clerk org membership

| # | Done when | Complete |
|---|---|---|
| A15 ✓ | An invited Clerk org member can list and open every project in that org without a manual `project_members` row | [x] |

- **Spec reference**: §3.6 (`project_members` is the auth source of truth); §14 task 1.33 ("Teammate accepts invite and sees projects"); §15 exit criterion ("A teammate can be invited to the org and see the same annotations"). A14 introduced `myRole: projectRoleSchema.nullable()` with the explicit semantic *null = caller is org member but not a project member*.
- **Problem**: Phase 1 has no project-level invitation UI — invitations happen at the Clerk org tier via `<OrganizationProfile />`. Pre-1.33, an invited teammate became a Clerk org member but had no `project_members` row, so:
  - `projects.list` / `getBySlug` showed projects with `myRole=null` via LEFT JOIN, but
  - any procedure gated on `assertProjectMember` (annotations.list/get/listEvents/update, REST `requireProjectMember` callers) returned **404 NotFoundError** to avoid leaking project existence.
  - Net effect: invited teammates saw project rows but couldn't open any annotation, blocking the §15 exit criterion.
- **Proposed deliverable**:
  - Webhook-driven sync: handle `organizationMembership.created`, `organizationMembership.updated`, `organizationMembership.deleted` in `apps/api/src/routes/webhooks/clerk.ts` and the matching Zod variants in `packages/shared/src/schemas/clerk.ts`. New service exports in `apps/api/src/services/clerk-sync.service.ts`: `syncProjectMembersForOrgMember`, `removeProjectMembersForOrgMember`, `provisionProjectMembersFromOrgMemberships`. Role default is **`editor`** for every fan-out — project-level admin remains assigned only to the project creator at `project.service.ts:75`. `ON CONFLICT DO NOTHING` everywhere preserves the creator's `admin` row.
  - Project-creation fan-out: `createProject` calls `clerk.organizations.getOrganizationMembershipList` and inserts an `editor` row per current org member alongside the creator's `admin` row. Local `users` rows for newly-invited members are lazily provisioned via `provisionUserFromClerk` when the user.created webhook hasn't yet landed.
  - Auth-plugin backstop: after `provisionOrgsFromMemberships` in `apps/api/src/plugins/auth.ts`, run `provisionProjectMembersFromOrgMemberships` to mint missing `editor` rows for the caller across every project in their Clerk-confirmed orgs. Two queries per request (anti-join SELECT + batch INSERT only when missing); zero inserts on warm requests where state is already in sync. Mirrors the existing user/org backstops; covers webhook lag and `docs/runbooks/setup.md:124` (local dev runs without ngrok).
  - Clerk client decoration: extracted to a new `apps/api/src/plugins/clerk.ts` so the webhook handler, the auth plugin, and tRPC procedures all share one `fastify.clerk` instance. tRPC `Context` gains `clerk: ClerkClient` so `projects.create` can pass it into the service layer.
- **Done when**:
  - Webhook handler + service helpers ship and are unit-tested
  - `createProject` fans out to all current Clerk org members (covered by `tRPC projects.create > fans out editor rows to all other current Clerk org members`)
  - Auth-plugin backstop covered by `tRPC annotations.list > invited org member with no project_members row → 200 after auth backstop`
  - E2E spec `apps/dashboard/e2e/team-invite.spec.ts` provisions a second Clerk user, adds them as `org:member`, signs in via `mintSignInToken`, and asserts the seeded project is listed and its detail page renders without 404
  - `docs/runbooks/environments.md` enumerates the new event subscriptions for the Clerk-prod webhook config
- **Conflicts / overlaps with spec**:
  - Reframes A14's nullable `myRole` semantic. After A15, `myRole` for an org member is effectively never `null` once they've made one authenticated request — the backstop fans out an `editor` row first. The schema stays nullable because the column on the wire still describes "no project_members row in DB at the moment of the read", and a non-org caller (extension API token) can still legitimately surface as `null`.
  - Several "non-member" integration tests pre-1.33 expressed the gap as "org member without project_members row → 404". Those scenarios are no longer reachable through the auth path; the tests were rewritten to "user from a different org → 404", which is the only way the existence-leak guard now fires.
- **Affected tasks / components**:
  - Tasks 1.32 (settings page — A14's gating still works because the gate is on `myRole !== "admin"`, not on null)
  - Task 1.27 (extension upload flow — invited teammates can now presign uploads as editors)
  - Task 1.29 (sidebar thread view — same, annotations.list now returns 200 for invited teammates)
  - `apps/api/src/{plugins/clerk.ts,plugins/auth.ts,routes/webhooks/clerk.ts,services/clerk-sync.service.ts,services/project.service.ts,trpc/{trpc.ts,context.ts,procedures/projects.ts}}`, `packages/shared/src/schemas/clerk.ts`, `apps/api/src/{routes/projects/index.ts,routes/uploads,routes/annotations}/*.integration.test.ts`, `apps/api/src/trpc/{projects,annotations}.integration.test.ts`, `apps/dashboard/e2e/team-invite.spec.ts`, `docs/runbooks/environments.md`.
- **Dependencies**: `in task 1.33` (this is the implementation of that task — bundled).
- **Estimated size**: `m`.
- **Status**: `done in task 1.33`. Webhook sync + create-time fan-out + auth-plugin backstop all landed together. Role-mapping question (whether `org:admin` should imply project `admin`) was deliberately deferred — Phase 1's project-admin role still tracks the project creator, and there's no UI to escalate. Revisit if a beta partner asks for "all org admins manage all projects".

## A16 — Extension production build env + prod Clerk allowlist

| # | Done when | Complete |
|---|---|---|
| A16 | A `build:prod` of the extension talks to the prod Clerk instance + `app.remarks.online`, and the deterministic chrome-extension origin is in `remarks-prod`'s `allowed_origins` | [ ] |

- **Spec reference**: §13/§14 don't define an extension production-build flow; ADR 0014 (`docs/adr/remarks-adr-0014-clerk-sync.md`) covers the syncHost design but not how the extension swaps environments at build time.
- **Problem**: `apps/extension/.env` is the only env file the extension reads, and it's hard-coded for dev (`pk_test_…` against the `remarks-dev` Clerk instance, `WXT_CLERK_SYNC_HOST=http://localhost:3000`). There was no `build:prod` script and no `.env.production` template, so a Web-Store-distributed build today would still talk to dev Clerk and the local dashboard. Symptom that surfaced this gap: enabling Google on `remarks-prod` shows the button on `app.remarks.online/sign-in` but a "prod" extension build still hits `remarks-dev` and never sees the new providers (the same trap applies to any future prod-only Clerk config — webhooks, MFA, etc.).
- **Proposed deliverable** (this task, A16):
  - `pnpm --filter @remarks/extension build:prod` runs `wxt build --mode production` via the existing `prepare-with-exit.cjs` wrapper, which makes Vite layer `apps/extension/.env.production` over `.env`.
  - `apps/extension/.env.example` documents the `.env.production` shape (`pk_live_…`, `https://api.remarks.online`, `https://clerk.remarks.online` — see syncHost gotcha below) and the one-time allowlist invocation.
  - **syncHost gotcha (the one that took a debug round to find):** in dev, `WXT_CLERK_SYNC_HOST` points at the **dashboard** (`http://localhost:3000`) because Clerk's dev-browser-token lives there. In prod it points at the **Clerk Frontend API** (`https://clerk.remarks.online`), because that's where the production `__client` cookie is set — `@clerk/chrome-extension` looks for that exact cookie name on syncHost (chunk-SYSWCRXO.js: `var CLIENT_JWT_KEY = "__client"`). Setting prod syncHost to the dashboard reads zero relevant cookies and the popup silently reports `signedIn: false` with no errors. Source: https://clerk.com/docs/chrome-extension/getting-started/quickstart.
  - One-time `CLERK_SECRET_KEY=sk_live_… pnpm --filter @remarks/scripts exec tsx tools/scripts/clerk-allowlist-extension.ts baikikfefeheiildmfoaicbjbnbecgjd` — the script (`tools/scripts/clerk-allowlist-extension.ts:1-69`) is idempotent and the extension ID is deterministic via `manifest.key` in `wxt.config.ts:9`.
  - **Enable the Clerk "Native API" toggle on the prod instance.** The `@clerk/chrome-extension` SDK runs in Native API mode (the failing URL ends in `?_is_native=1`); without the toggle, every popup load 400s with `Native API is disabled for this instance`. Dev was already on; prod was not. Verify with `curl -s -o /dev/null -w '%{http_code}' 'https://clerk.remarks.online/v1/environment?_is_native=1'` returning `200`.
- **Done when**:
  - `apps/extension/package.json` has a `build:prod` script
  - `apps/extension/.env.example` documents the prod env shape and the allowlist command
  - The prod Clerk instance's `allowed_origins` contains `chrome-extension://baikikfefeheiildmfoaicbjbnbecgjd` (run the script with `sk_live_…` once)
  - The prod Clerk instance has the **Native API** feature enabled
  - A `build:prod` artifact loaded in Chrome successfully completes a sign-in via `app.remarks.online` and the popup flips to the `Show when="signed-in"` branch in `apps/extension/src/entrypoints/popup/App.tsx:68`
- **Conflicts / overlaps with spec**: None. Phase 0/1 spec is silent on extension prod packaging; this just documents and codifies the missing wiring.
- **Affected tasks / components**: `apps/extension/.env.example`, `apps/extension/package.json`, `apps/extension/src/{entrypoints/popup/App.tsx,entrypoints/background.ts}` (no source changes — only behavior verified), `tools/scripts/clerk-allowlist-extension.ts` (executed once with `sk_live_`).
- **Dependencies**: Independent. Pre-requisite for any task that exercises prod Clerk config from the extension (e.g., A17 below).
- **Estimated size**: `xs`.
- **Status**: `in progress` — bundled with the Google-social-connection rollout.

## A20 — Remove the Clerk OAuth bridges (custom scopes + audience binding)

| # | Done when | Complete |
|---|---|---|
| A20 | `apps/mcp/src/lib/jwt.ts` enforces real scope grants and a strictly-required `aud` claim; PRM/401 advertise real scopes; runbook §3-§4 are unblocked | [ ] |

- **Spec reference**: `docs/runbooks/clerk-mcp-setup.md` §3 ("Define the MCP scopes"), §4 ("Configure the resource (audience)"); ADR-0015 §4.
- **Problem**: Clerk's OAuth provider (April 2026) ships an incomplete OAuth-as-AS surface for MCP. Two specific gaps that the MCP server bridges:
  1. **Custom scopes are roadmap-only.** Only the built-in catalog (`openid`, `profile`, `email`, `public_metadata`, `private_metadata`, `offline_access`) is issuable. Confirmed via `clerk.com/docs/guides/configure/auth-strategies/oauth/scoped-access` and probing the prod AS metadata.
  2. **No "Allowed resources" Dashboard UI / no `aud` on issued OAuth tokens.** RFC 8707 resource indicators are documented in our runbook §4 but Clerk's OAuth provider does not honor the `resource` parameter today — the access tokens it emits omit `aud` entirely. The MCP server initially rejected those tokens; the bridge accepts a missing `aud` while still rejecting a present-but-mismatched one.
- **Proposed deliverable**: When Clerk ships both:
  - `apps/mcp/src/routes/well-known.ts` — restore `scopes_supported: ["tasks:read", "tasks:write", "project:read"]`.
  - `apps/mcp/src/plugins/mcp-auth.ts` — restore `REQUIRED_SCOPES = "tasks:read tasks:write project:read"`.
  - `apps/mcp/src/lib/jwt.ts` — drop the `REMARKS_SCOPES` fallback in `parseScopes()` and tighten the audience check from "if present, must match" back to "must be present and match".
  - `docs/runbooks/clerk-mcp-setup.md` §3-§4 — remove the "not yet supported" caveats.
- **Done when**:
  - The three custom scopes are defined in Clerk Dashboard for prod (and dev) and appear in the AS metadata `scopes_supported`.
  - The canonical resource URI (`https://mcp.remarks.online/mcp`) is registered as an Allowed Resource in Clerk Dashboard, and Clerk-issued tokens carry `aud` matching it.
  - Code reverts above are merged; the FORBIDDEN tests in `apps/mcp/src/tools/*.test.ts` pass against real Clerk-issued tokens missing a given scope.
- **Conflicts / overlaps with spec**: ADR-0015 §4 + §3 imply both custom scopes and audience binding work today; this gap and the bridges are the temporary deviation.
- **Affected tasks / components**: `apps/mcp/src/lib/jwt.ts`, `apps/mcp/src/plugins/mcp-auth.ts`, `apps/mcp/src/routes/well-known.ts`, `docs/runbooks/clerk-mcp-setup.md`.
- **Dependencies**: After Clerk ships custom OAuth scopes *and* honors the RFC 8707 `resource` parameter (track `clerk.com/changelog`).
- **Estimated size**: `xs`.
- **Status**: `open`.

## A19 — Sidebar injection policy: dogfood on dashboard, exclude auth pages

| # | Done when | Complete |
|---|---|---|
| A19 ✓ | Sidebar injects on `app.remarks.online` + `localhost:3000` for dogfooding; excluded on Google/Apple/Clerk auth pages | [x] |

- **Spec reference**: not specified.
- **Problem**: Original `apps/extension/src/entrypoints/content.tsx:17` excluded `app.remarks.online` and `localhost:3000` from content-script injection ("double-UI"; HMR-reload errors). That decision blocked dogfooding — we couldn't use Remarks to annotate Remarks. Conversely, `<all_urls>` matches with no auth-provider exclusions meant the sidebar **flashed mid-OAuth on `accounts.google.com` / `appleid.apple.com`** and **persisted whenever users visited `clerk.remarks.online` directly** (the new prod syncHost endpoint per A16). The OAuth flash had been deferred earlier in this session ("leave it") but the persistent FAPI case made it visible enough to address.
- **Proposed deliverable**:
  - Drop `app.remarks.online` and `localhost:3000` from `excludeMatches` (sidebar now injects on the dashboard for dogfooding).
  - Add `accounts.google.com`, `appleid.apple.com`, `clerk.remarks.online`, `*.clerk.accounts.dev` to `excludeMatches` (sidebar stays out of OAuth/FAPI flows).
  - Update the leading comment to document the dogfooding rationale + the auth-page exclusion rationale.
- **Done when**:
  - Loading the prod extension on `https://app.remarks.online/app/projects` shows the sidebar
  - Loading on `https://accounts.google.com` does not show the sidebar
  - Loading on `https://clerk.remarks.online/` does not show the sidebar
  - HMR errors during `pnpm dev` on `localhost:3000` are still tolerable (the existing `isExtensionContextValid` guard mitigates them)
- **Conflicts / overlaps with spec**: None.
- **Affected tasks / components**: `apps/extension/src/entrypoints/content.tsx`. No other files.
- **Dependencies**: After A16 (the prod syncHost change in A16 is what made `clerk.remarks.online` visit-able as a sidebar-injected page in the first place).
- **Estimated size**: `xs`.
- **Status**: `done in this PR`. Bundled with the Google-social-connection rollout.

## A18 — Localhost dev origins baked into prod extension bundle

| # | Done when | Complete |
|---|---|---|
| A18 | A `build:prod` artifact contains no `localhost:3000` references in `manifest.json`, `background.js`, or content scripts | [ ] |

- **Spec reference**: not specified. ADR 0014 covers syncHost but not bundle hygiene across modes.
- **Problem**: `apps/extension/wxt.config.ts:38-50` declares `http://localhost:3000/*` statically in `externally_connectable.matches` and (transitively, via WXT) in `content_scripts.exclude_matches`. `apps/extension/src/entrypoints/background.ts:190-193` hardcodes the same origin into `EXTERNAL_PING_ALLOWED_ORIGINS`. Result: a `pnpm --filter @remarks/extension build:prod` artifact still ships with `localhost:3000` in the manifest and the runtime allowlist. Not auth-coupled (auth uses env-driven `WXT_CLERK_SYNC_HOST`, which is correctly `https://app.remarks.online` in prod bundles), but a Web-Store-distributed prod extension would let a local dev dashboard at `localhost:3000` `chrome.runtime.sendMessage` it for the spec §7.5 install-detection ping. Tiny info-leak surface (a malicious local origin pretending to be localhost:3000 could probe whether a user has the extension installed); the explicit origin check in `background.ts:207` is the only gate.
- **Proposed deliverable**:
  - Drive the manifest matches and `EXTERNAL_PING_ALLOWED_ORIGINS` from a build-time env or the `import.meta.env.MODE === 'production'` flag, so prod bundles drop the localhost entry.
  - Verify with the same grep checks that confirmed prod-key/syncHost baking: `grep -rl "localhost:3000" .output/chrome-mv3` should return zero matches in a prod build.
- **Done when**:
  - Prod build artifact has zero `localhost:3000` references
  - Dev build artifact retains them (so onboarding handshake still works locally)
  - One smoke run of `pnpm --filter @remarks/dashboard dev` + `pnpm --filter @remarks/extension dev` confirms the dashboard's install-detection ping still works in dev
- **Conflicts / overlaps with spec**: None.
- **Affected tasks / components**: `apps/extension/wxt.config.ts`, `apps/extension/src/entrypoints/background.ts:190-193`. Possibly a tiny helper in `apps/extension/src/env.ts` for the mode branching.
- **Dependencies**: After A16 (the build:prod plumbing).
- **Estimated size**: `xs`.
- **Status**: `open`.

## A17 — Apple sign-in on dev + prod Clerk instances

| # | Done when | Complete |
|---|---|---|
| A17 | `app.remarks.online/sign-in` and the dev dashboard both render an Apple button that completes a real sign-in | [ ] |

- **Spec reference**: not specified. ADR 0003 (`docs/adr/0003-clerk-for-auth.md`) commits to Clerk for auth but doesn't enumerate social providers.
- **Problem**: Both the dashboard's `<SignIn>` / `<SignUp>` and the extension popup (which opens `${WXT_CLERK_SYNC_HOST}/sign-in` per `apps/extension/src/entrypoints/popup/App.tsx:42-48`) defer to whichever providers Clerk has enabled on the active instance. We want Apple alongside Google, but Apple — unlike Google in the dev instance — has no Clerk-shared OAuth credentials, so even the dev instance needs custom credentials. That requires an Apple Developer account ($99/yr) and is gated on org-level signup, so it was deferred from the Google rollout.
- **Proposed deliverable**:
  - **Apple Developer Console:** create a Service ID with Sign in with Apple enabled, add the Clerk callback URLs to its Return URLs, and generate a Sign-in-with-Apple key (.p8). Capture Service ID, Team ID, Key ID, and the .p8 contents.
    - Dev callback: `https://sweeping-cattle-24.clerk.accounts.dev/v1/oauth_callback`
    - Prod callback: `https://clerk.remarks.online/v1/oauth_callback`
  - **Clerk dev instance → SSO Connections → Add → Apple:** paste credentials, save.
  - **Clerk prod instance → SSO Connections → Add → Apple:** paste the same credentials (Apple keys are tied to the Apple Service ID, not to a Clerk environment).
  - Verify via the same matrix as Google: dev dashboard `/sign-in`, dev extension popup → dashboard sign-in tab, prod dashboard `/sign-in`, prod extension popup (depends on A16).
- **Done when**:
  - Both Clerk instances have an active Apple SSO connection
  - Dev dashboard, dev extension popup, prod dashboard, and prod extension popup all render an Apple button and complete a real Sign in with Apple round-trip
- **Conflicts / overlaps with spec**: None. Configuration inside the existing ADR-0003 ("Clerk for auth") decision; no new architectural choice.
- **Affected tasks / components**: Clerk instance config only — no repo files. Same dashboard `<SignIn>` / `<SignUp>` (`apps/dashboard/src/app/sign-in/[[...sign-in]]/page.tsx`, `apps/dashboard/src/app/sign-up/[[...sign-up]]/page.tsx`) and extension popup will pick up the new provider with no source changes.
- **Dependencies**: Independent of A16 for the dashboard surface; **after A16** for the prod-extension surface (otherwise prod-built extensions still hit dev Clerk).
- **Estimated size**: `s` once the Apple Developer account is in place; otherwise blocked on enrolment.
- **Status**: `open`.

## A21 — Personal + org scopes for `remarks_list_tasks`

| # | Done when | Complete |
|---|---|---|
| A21 ✓ | `remarks_list_tasks` returns personal tasks when `project_id`/`org_id` are omitted, and org-rolled-up tasks when `org_id` is set; `remarks_whoami` exposes `orgs` so the agent can drive both | [x] |

- **Spec reference**: Phase 2 spec §6.1 — "one OAuth login covers every project the user is a member of plus their personal annotations." The personal-annotation half of that promise existed in the schema/REST/dashboard but had no MCP surface; the org-scoped variant is a natural extension once whoami can advertise org IDs.
- **Problem**: Before this change, `remarks_list_tasks` required `project_id` and rejected anything else. An MCP user (e.g. an agent talking to `remarks.online` itself) with no project memberships had no way to see their personal annotations through MCP, and there was no way to sweep across all of one organisation's projects without hand-iterating IDs returned from `remarks_whoami`.
- **Proposed deliverable**:
  - **Schema (`packages/mcp-schema`)**: make `project_id` optional on `listTasksInputSchema`, add optional `org_id` (UUID), enforce mutual exclusion + `branch` requires `project_id` via `superRefine`. Make `mcpTaskSummarySchema.branch` nullable and add `project: { id, slug } | null`. Add `orgs` to `whoamiOutputSchema`.
  - **API (`apps/api`)**: extend `listAnnotationsForUser` with a `scope: "org"` mode + `orgId` filter, load the project relation so callers can populate the new `project` field. Add `AnnotationResponse.projectSlug` (mirrors `branchName`). Register `GET /internal/mcp/users/:clerkUserId/personal-annotations`, `GET /internal/mcp/users/:clerkUserId/orgs/:orgId/annotations`, `GET /internal/users/:clerkUserId/orgs`, and `GET /internal/users/:clerkUserId/orgs/:orgId`.
  - **MCP server (`apps/mcp`)**: three-way dispatch in `list-tasks` handler (project / org / personal); add `requireOrgAccess` shared helper; add `listAccessibleOrgs` + `assertOrgAccess` + `fetchListPersonalAnnotations` + `fetchListOrgAnnotations` to the api-client. Whoami fans out to projects + orgs in parallel.
- **Done when**:
  - [x] `remarks_list_tasks` (no args) returns personal tasks with `branch: null` and `project: null`
  - [x] `remarks_list_tasks` with `org_id` returns rows from every project the caller is a member of in that org, each row carrying its own `project: { id, slug }`
  - [x] `remarks_list_tasks` with `project_id` is unchanged behaviorally (output gains `project` populated for consistency)
  - [x] `remarks_list_tasks` with `branch` but no `project_id` → `VALIDATION_ERROR`
  - [x] `remarks_list_tasks` with both `project_id` and `org_id` → `VALIDATION_ERROR`
  - [x] `remarks_whoami` surfaces `orgs: [{ id, clerk_org_id, name, slug, role }]`
  - [x] Non-member org → `NOT_FOUND` (existence-leak posture)
  - [x] All three modes covered by unit tests; both new internal routes covered by integration tests
- **Conflicts / overlaps with spec**: None directly. The `branch` field on `mcpTaskSummarySchema` going from `string` to `string | null` is a soft-breaking output change, but the existing handler already filtered out null-branch rows defensively, so no shipping client has ever observed a null branch from this tool.
- **Affected tasks / components**: `packages/mcp-schema/src/{common,tools}.ts`, `packages/shared/src/schemas/annotation.ts`, `apps/api/src/services/{annotation,mcp}.service.ts`, `apps/api/src/routes/internal/{annotations,projects,user-orgs,index}.ts`, `apps/mcp/src/lib/api-client.ts`, `apps/mcp/src/tools/{list-tasks,whoami,shared,types}.ts`, `apps/mcp/src/routes/mcp.test.ts` (mocks).
- **Dependencies**: Independent. Lays useful groundwork for any future cross-project triage UX (e.g. an "all my tasks" dashboard view) but doesn't block A15 (org-membership sync).
- **Estimated size**: `m`.
- **Status**: `done in PR (this branch)`.
