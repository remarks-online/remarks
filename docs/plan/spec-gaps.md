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
- **Status**: `in progress` — code-side wiring is in place (`build:prod` script, `.env.example`, syncHost gotcha documented). Outstanding: prod Clerk Native API toggle, prod `allowed_origins` entry for `chrome-extension://baikikfefeheiildmfoaicbjbnbecgjd`, and the end-to-end sign-in test of a `build:prod` artifact against `app.remarks.online`.

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

## A18 — Localhost dev origin baked into prod extension bundle via runtime constant

| # | Done when | Complete |
|---|---|---|
| A18 | A `build:prod` artifact contains no `localhost:3000` references in `background.js` (the manifest side is already mode-branched in `wxt.config.ts`) | [ ] |

- **Spec reference**: not specified. ADR 0014 covers syncHost but not bundle hygiene across modes.
- **Problem**: `apps/extension/wxt.config.ts:16,51,60` already drops `http://localhost/*` and `http://localhost:3000/*` from `host_permissions` and `externally_connectable.matches` in prod via `const isProd = process.env.NODE_ENV === "production"`. The remaining leak is `apps/extension/src/entrypoints/background.ts:190-193`, which hardcodes both `https://app.remarks.online` and `http://localhost:3000` in `EXTERNAL_PING_ALLOWED_ORIGINS`. The constant gets bundled into every build (including prod), so `grep -rl "localhost:3000" .output/chrome-mv3` still returns matches in `background.js` after `pnpm build:prod`. Tiny info-leak surface (a malicious local origin pretending to be localhost:3000 could probe whether a user has the extension installed), but trivial to close once the manifest half is already mode-branched.
- **Proposed deliverable**:
  - Mode-branch `EXTERNAL_PING_ALLOWED_ORIGINS` the same way `wxt.config.ts` does — either via `import.meta.env.MODE === 'production'` inside `background.ts`, or by exporting the allowlist from a tiny helper in `apps/extension/src/env.ts` that already knows the mode.
  - Verify with `grep -rl "localhost:3000" .output/chrome-mv3` returning zero matches after `pnpm --filter @remarks/extension build:prod`.
- **Done when**:
  - Prod build artifact has zero `localhost:3000` references (manifest + background script)
  - Dev build artifact retains them (so onboarding handshake still works locally)
  - One smoke run of `pnpm --filter @remarks/dashboard dev` + `pnpm --filter @remarks/extension dev` confirms the dashboard's install-detection ping still works in dev
- **Conflicts / overlaps with spec**: None.
- **Affected tasks / components**: `apps/extension/src/entrypoints/background.ts:190-193`. Possibly a tiny helper in `apps/extension/src/env.ts` for the mode branching.
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
