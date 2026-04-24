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
| A4 | §5 (or §7.3) pins a canonical tRPC Context shape and `apps/api/src/trpc/trpc.ts` matches | [ ] |

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
- **Status**: `open` — code shipped; spec edit pending.

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
- **Status**: `done in task 1.14`.

## A6 — Spec §10.2 still says Testcontainers; repo uses a Postgres service container

| # | Done when | Complete |
|---|---|---|
| A6 | §10.2 no longer mentions Testcontainers and describes the GitHub Actions service-container setup per CLAUDE.md §1.5 | [ ] |

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
- **Status**: `open`.

## A7 — Dashboard loading skeletons via in-page Suspense (deferred from task 1.20)

| # | Done when | Complete |
|---|---|---|
| A7 | Both projects pages stream slow parts behind `<Suspense>`; no new `loading.tsx`; 404 e2e still passes | [ ] |

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
- **Status**: `open`.
