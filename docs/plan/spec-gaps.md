# Spec amendments — Phase 0-1

This document is the backlog for changes that don't fit cleanly as a numbered task in `remarks-phase-0-1-spec.md` §13/§14 but that need to happen. Each entry is an **independent unit of work** that can be picked up between numbered spec tasks — not just a note.

IDs are stable (`A1`, `A2`, …) so they can be referenced from PR titles and commits, e.g., `chore(spec): address A6 — update §10.2 testing language`. Closed entries are folded into the appropriate spec doc and removed from this file; this doc is the **TODO list of work that is not yet done**, not a historical record. Surviving IDs keep their numbers (gaps in the sequence are expected) so any past PR title still resolves coherently.

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
- **Status** — `open` / `in progress (PR #NN)` / `deferred to phase N` / `rejected (see rationale)`

---

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
  - Verify via the same matrix as Google: dev dashboard `/sign-in`, dev extension popup → dashboard sign-in tab, prod dashboard `/sign-in`, prod extension popup (depends on the extension prod-build flow now in Phase 0/1 spec §6.2 "Production build").
- **Done when**:
  - Both Clerk instances have an active Apple SSO connection
  - Dev dashboard, dev extension popup, prod dashboard, and prod extension popup all render an Apple button and complete a real Sign in with Apple round-trip
- **Conflicts / overlaps with spec**: None. Configuration inside the existing ADR-0003 ("Clerk for auth") decision; no new architectural choice.
- **Affected tasks / components**: Clerk instance config only — no repo files. Same dashboard `<SignIn>` / `<SignUp>` (`apps/dashboard/src/app/sign-in/[[...sign-in]]/page.tsx`, `apps/dashboard/src/app/sign-up/[[...sign-up]]/page.tsx`) and extension popup will pick up the new provider with no source changes.
- **Dependencies**: Independent of the extension prod-build flow (Phase 0/1 spec §6.2) for the dashboard surface; **after** that flow for the prod-extension surface (otherwise prod-built extensions still hit dev Clerk).
- **Estimated size**: `s` once the Apple Developer account is in place; otherwise blocked on enrolment.
- **Status**: `open`.

## A22 — Terms of Service + DPA pages (deferred, blocks Phase 3 launch)

| # | Done when | Complete |
|---|---|---|
| A22 | `app.remarks.online/terms` and `app.remarks.online/dpa` are live with lawyer-reviewed content; privacy policy footer + privacy policy text link to them | [ ] |

- **Spec reference**: Phase 3 spec §11 deliverable 3D.5 — "Legal pages: Privacy Policy, Terms of Service, DPA (lawyer-reviewed) | Live at `/privacy`, `/terms`, `/dpa`".
- **Problem**: The Chrome Web Store submission only requires a privacy policy URL, which this branch ships at `app.remarks.online/privacy` (markdown source at `docs/legal/privacy.md`). Terms of Service and the DPA are still missing. The privacy policy text references "our agreements" / "Terms of Service" in §4 and §6.2; those references currently point to a 404. Public launch (Phase 3) and any paid plan need the ToS shipped before billing collects a customer's credit card.
- **Proposed deliverable**:
  - **Markdown source:** `docs/legal/terms.md` and `docs/legal/dpa.md`, modeled on the same structure as `docs/legal/privacy.md` (comprehensive sections, US + EU posture, Vercel/Linear style).
  - **Live routes:** `apps/dashboard/src/app/terms/page.tsx` and `apps/dashboard/src/app/dpa/page.tsx`, mirroring `apps/dashboard/src/app/privacy/page.tsx` (semantic HTML, same footer link style on the homepage).
  - **Footer:** add `/terms` to the homepage footer alongside the existing `/privacy` link. DPA stays unlinked from the homepage; surface it from the privacy policy text instead.
  - **Privacy policy edits:** wherever privacy.md / privacy/page.tsx says "our agreements" or refers to terms, link to `/terms`. Wherever it discusses subprocessor DPAs, link to `/dpa`.
  - **Lawyer review:** out-of-band before public launch. Engineering ships the drafts; legal redlines happen separately and replace the doc text once finalized.
- **Done when**:
  - `docs/legal/terms.md` and `docs/legal/dpa.md` exist with complete content
  - `/terms` and `/dpa` routes return 200 with full content rendered
  - Homepage footer links `/privacy` and `/terms`; both navigate to live pages
  - `docs/legal/privacy.md` and `apps/dashboard/src/app/privacy/page.tsx` no longer reference unlinked "Terms of Service" — they link `/terms` and `/dpa` consistently
- **Conflicts / overlaps with spec**: None. Phase 3 §11 explicitly enumerates these as deliverables; this entry exists only because the CWS submission forces a privacy policy earlier than Phase 3 was planned, and the ToS/DPA naturally accompany it.
- **Affected tasks / components**: New files only (`docs/legal/terms.md`, `docs/legal/dpa.md`, `apps/dashboard/src/app/terms/page.tsx`, `apps/dashboard/src/app/dpa/page.tsx`). Edits to `docs/legal/privacy.md`, `apps/dashboard/src/app/privacy/page.tsx`, `apps/dashboard/src/app/page.tsx` (footer).
- **Dependencies**: Independent of `A22 — CWS submission` itself; CWS only requires the privacy URL. Blocks any paid-plan / public-launch task in Phase 3 that collects payment or signs up an organization on terms.
- **Estimated size**: `m` for the drafts; lawyer review is out-of-band and not on the engineering critical path.
- **Status**: `open`.

## A23 — Nightly R2 orphan sweeper (deferred from task 2.30)

| # | Done when | Complete |
|---|---|---|
| A23 | Inngest scheduled function reaps R2 keys not referenced by `annotation_assets` within 24h of orphaning | [ ] |

- **Spec reference**: `docs/plan/remarks-phase-2-spec.md` line 846 (task 2.30 final clause: "nightly sweep reconciles R2 against the `annotation_assets` table to clean up Phase 1 orphans").
- **Problem**: Issue #76 shipped on-delete cleanup for `deleteAnnotation` / `deleteProject` / `deleteOrg` but explicitly de-scoped the recurring sweeper. Phase 1 created R2 objects without on-delete cleanup, so any keys orphaned before issue #76 are still in the bucket; in steady state the sweeper is also the safety net for the rare case where Inngest publish fails after the DB delete commits (`apps/api/src/inngest/publish.ts` swallows + logs).
- **Proposed deliverable**: A scheduled Inngest function `r2-orphan-sweep` running daily (e.g. 03:00 UTC) that lists every key in `R2_BUCKET_SCREENSHOTS`, batches them against `annotation_assets.r2_key`, and `DeleteObjects` anything unreferenced and older than 24h (grace window for in-flight uploads whose row hasn't been written yet). Function lives next to `r2-cleanup` at `apps/api/src/inngest/functions/r2-orphan-sweep.ts` and registers via `inngestServeRoutes` like its sibling.
- **Done when**:
  - Function deployed and running on schedule against `remarks-screenshots-prod`
  - A manually-orphaned key (insert without a matching `annotation_assets` row, age >24h) is removed on the next run
  - Audit log: function emits a structured log line `{ scanned, deleted, skippedYoung }` per run for observability
- **Conflicts / overlaps with spec**: None — this completes the original task 2.30 scope.
- **Affected tasks / components**: `apps/api/src/inngest/functions/r2-orphan-sweep.ts` (new), `apps/api/src/inngest/serve.ts` (register), test suite (integration vs MinIO).
- **Dependencies**: After issue #76 (Inngest scaffold + on-delete cleanup).
- **Estimated size**: `m`.
- **Status**: `open`.

## A24 — Extension prod redirects 404 because `WXT_CLERK_SYNC_HOST` is the Clerk FAPI, not the dashboard

| # | Done when | Complete |
|---|---|---|
| A24 ✓ | Every "open a tab to the dashboard" redirect in the extension uses `WXT_DASHBOARD_URL` (sign-in lands on `app.remarks.online/sign-in` in prod, not `clerk.remarks.online/sign-in`) | [x] |

- **Spec reference**: Phase 0/1 spec §6.2 "Production build" (the prod-build flow that swapped `WXT_CLERK_SYNC_HOST` to the Clerk FAPI `https://clerk.remarks.online` so `__client` cookie sync works, but did not split the variable out from its other use sites).
- **Problem**: Five call sites in the extension were building dashboard URLs by appending paths to `WXT_CLERK_SYNC_HOST` — `popup/App.tsx` (`openSignIn`/`openSignUp`), `SidebarSignedOut.tsx`, `SidebarMoreMenu.tsx` (the "open dashboard" fallback), and `popup/ProjectPicker.tsx` (`openNewProjectTab`). That worked in dev because syncHost happens to be `localhost:3000` (the dashboard). In prod the two URLs diverge — syncHost is `clerk.remarks.online` (FAPI) and the dashboard is `app.remarks.online` — so every redirect 404s. Symptom that surfaced this: clicking **Sign in** in the production extension popup opens `https://clerk.remarks.online/sign-in` and Clerk returns 404.
- **Proposed deliverable**:
  - New env var `WXT_DASHBOARD_URL` (added to `apps/extension/src/env.ts` schema and documented in `apps/extension/.env.example`). Dev: `http://localhost:3000`. Prod: `https://app.remarks.online`.
  - All five call sites switched to `env.WXT_DASHBOARD_URL`. `WXT_CLERK_SYNC_HOST` is left exclusively for `<ClerkProvider syncHost>` (popup) and `createClerkClient({ syncHost })` + `cookies.onChanged` (background) — i.e., cookie sync only.
  - E2E + verify suites updated: `apps/extension/e2e/fixtures.ts`, `apps/extension/verify/auth-flow.spec.ts`, and `apps/extension/verify/README.md` switch their dashboard navigation (sign-in ticket redemption) to `WXT_DASHBOARD_URL`. `turbo.json`'s `build.env` array adds the new var so Turbo's sanitized env exposes it to `wxt build`. `.github/workflows/ci.yml` sets `WXT_DASHBOARD_URL=http://localhost:3000` for the extension-e2e job.
- **Done when**:
  - Dev build: clicking **Sign in** / **Create account** in the popup opens `http://localhost:3000/sign-in`.
  - Prod build (after `apps/extension/.env.production` adds `WXT_DASHBOARD_URL=https://app.remarks.online`): same buttons open `https://app.remarks.online/sign-in`.
  - `pnpm turbo typecheck/lint/test/build --filter="*"` clean; extension-e2e CI green.
- **Conflicts / overlaps with spec**: None — Phase 0/1 spec §6.2's note about syncHost being the FAPI in prod stands; this amendment just extracts the dashboard-URL responsibility into its own variable.
- **Affected tasks / components**: `apps/extension/src/env.ts`, `apps/extension/src/entrypoints/popup/App.tsx`, `apps/extension/src/entrypoints/popup/ProjectPicker.tsx`, `apps/extension/src/components/SidebarSignedOut.tsx`, `apps/extension/src/components/SidebarMoreMenu.tsx`, `apps/extension/.env.example`, `apps/extension/e2e/fixtures.ts`, `apps/extension/e2e/playwright.config.ts`, `apps/extension/verify/auth-flow.spec.ts`, `apps/extension/verify/README.md`, `turbo.json`, `.github/workflows/ci.yml`. PR description reminds whoever ships the next CWS build to add `WXT_DASHBOARD_URL=https://app.remarks.online` to `apps/extension/.env.production` before running `build:prod`.
- **Dependencies**: After the extension prod-build flow (Phase 0/1 spec §6.2). Pre-requisite for any future CWS submission.
- **Estimated size**: `xs`.
- **Status**: `done in PR #83`.
