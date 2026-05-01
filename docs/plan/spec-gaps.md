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

## A25 — Live SSE event stream for annotations (G9)

| # | Done when | Complete |
|---|---|---|
| A25 | `GET /projects/:projectId/events` and `GET /users/:userId/events` (Clerk + internal-MCP variants) stream every `annotationEvents` write within ~1 s; resume via `Last-Event-ID` works against in-memory buffer and DB; integration tests cover happy path, 404 for non-members, and resume | [x] |

- **Spec reference**: `docs/analysis/2026-04-30-agentation-vs-remarks.md` G9. Phase 0/1 spec did not specify a real-time channel.
- **Problem**: Today every consumer of annotation activity polls. The dashboard's annotation list is static-until-refresh, and any "agent watch loop" (G10 in the same analysis) has nothing to subscribe to.
- **Proposed deliverable**:
  - `packages/shared/src/schemas/annotation-stream.ts` — wire envelope + `<createdAtIso>:<uuid>` resume id encoder/parser.
  - `apps/api/src/lib/annotation-event-bus.ts` — broker with per-project / per-user fan-out, in-memory ring buffer (256 events), connection cap (`MAX_SSE_CONNECTIONS`, default 200), lazy `LISTEN` attach.
  - `apps/api/src/lib/sse.ts` — hand-rolled SSE channel: hello frame, 25 s keepalive, 5 min connection rotation (`MAX_SSE_CONNECTION_MS`), `event: rotate` close.
  - `apps/api/src/plugins/annotation-event-bus.ts` — Fastify plugin; uses `@remarks/db` `createListenClient` for a dedicated 1-connection LISTEN socket.
  - `apps/api/src/routes/events/index.ts` (Clerk auth) and `apps/api/src/routes/internal/events.ts` (internal-MCP) — four endpoints total.
  - `apps/api/src/services/event-stream.service.ts` — DB replay with keyset paging on (createdAt, id), capped at 200 events with `replay_truncated` signal.
  - `apps/api/src/services/{annotation,mcp}.service.ts` — thread an `AnnotationEventPublisher` through the four annotation-event insertion sites; broadcast post-commit.
  - `docs/adr/0019-sse-event-stream.md` — NOTIFY-not-Redis decision, capacity assumptions, lazy-LISTEN rationale.
- **Done when**:
  - All seven test suites in `pnpm turbo {typecheck,lint,test,build} --filter="*"` pass plus `apps/api` integration suite (verified locally on 2026-05-01).
  - SSE happy-path + Last-Event-ID replay + 404-for-non-member integration tests pass against real Postgres.
  - ADR-0019 merged.
- **Conflicts / overlaps with spec**: None — this is purely additive.
- **Affected tasks / components**: enables D1 (live activity feed) and G10 (`watch_annotations` MCP tool).
- **Dependencies**: independent.
- **Estimated size**: `m`. Shipped 2026-05-01.
- **Status**: `done — folded into ADR-0019; entry kept until cleanup sweep`.

---

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

## A23 — Alpha extension distribution via R2 + dashboard download page

| # | Done when | Complete |
|---|---|---|
| A23 | CI uploads each release zip to R2; `/app/download-extension` surfaces a Clerk-gated download with the running version visible in the extension's three-dot menu | [x] |

- **Spec reference**: not specified. Bridges A8 (Chrome Web Store submission, still open) so alpha testers can install before the store listing lands.
- **Problem**: The extension is invitation-only alpha but there's no self-serve install path. The founder is the bottleneck for every install — they have to build, zip, and hand the file off manually.
- **Proposed deliverable**:
  - New private R2 bucket `remarks-extension-builds` (prod) / `remarks-extension-builds-dev` (dev). New required env var `R2_BUCKET_EXTENSION_BUILDS` on the API.
  - `.github/workflows/extension-release.yml` extended to build (`build:prod`), zip (`pnpm zip`), sha256, and upload to `releases/chrome/remarks-chrome-<version>.zip` + `releases/chrome/latest.json` via `tools/scripts/upload-extension-build.ts`.
  - New API endpoint `GET /v1/extension/latest` (Clerk-authed) returns `{ version, downloadUrl, sha256, sizeBytes, uploadedAt }` with a 1-hour presigned URL minted per visit.
  - New dashboard page `/app/download-extension` (server component) renders install instructions and a `Download Remarks v<version> (.zip)` button. New top-nav link.
  - Onboarding's "Loading manually" panel reduced to a one-line link to the new page.
  - Extension's three-dot menu shows `Remarks v<version>` (read from `chrome.runtime.getManifest()`) so users know what they have installed.
  - **ADR-0017**, **`docs/runbooks/extension-distribution.md`**, and updates to **`docs/store/chrome-web-store.md`** §1.
- **Done when**:
  - A push to `main` touching `apps/extension/**` results in a new key under `releases/chrome/` and an updated `latest.json` in the prod bucket.
  - `/app/download-extension` renders the latest version on the button and the download click downloads the matching zip.
  - The extension three-dot menu's footer shows the manifest version of the running extension.
  - Integration test for `/extension/latest` passes against MinIO.
- **Conflicts / overlaps with spec**: None. Bridges A8 — when the Chrome Web Store listing lands, decide whether to keep this path as a fallback or sunset it (redirect to the CWS URL).
- **Affected tasks / components**: `apps/api/src/routes/extension/`, `apps/api/src/lib/r2.ts` (new `withBucket` helper), `apps/api/src/env-schema.ts`, `apps/dashboard/src/app/app/download-extension/`, `apps/dashboard/src/app/app/layout.tsx`, `apps/dashboard/src/app/app/onboarding/_components/step-install-extension.tsx`, `apps/extension/src/components/SidebarMoreMenu.tsx`, `tools/scripts/upload-extension-build.ts`, `.github/workflows/extension-release.yml`, `.github/workflows/ci.yml`.
- **Dependencies**: Independent. Eventually superseded by A8.
- **Estimated size**: `m`.
- **Status**: `in progress`.
