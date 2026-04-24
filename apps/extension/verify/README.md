# `verify/` — local extension service-worker verification

Playwright suite that boots the built extension in a real Chromium and drives the pieces of the MV3 service worker that CI and unit tests can't reach. **Not part of CI.** Not part of the turbo pipeline. Run locally when extension SW code changes or before shipping tasks 1.27 / 1.29 / 1.30.

Specs:
- `auth-flow.spec.ts` — Clerk `createClerkClient({ background: true })` mints a valid Bearer token (task 1.21 / A10).
- `screenshot-preview.spec.ts` — `captureScreenshot` handler cuts a valid PNG out of the visible tab (task 1.26).

## Why this is separate from `apps/extension/e2e/`

`e2e/` is reserved for the Playwright happy-path suite scheduled in spec §14 task 1.31 (runs in CI). `verify/` is architectural verification — it drives the real Clerk API and a running dashboard, which makes it CI-hostile. Keeping them separate so task 1.31 can land without inheriting this baggage.

## Setup

No new env file required — the suite reads the same files every other workflow uses. Make sure these are populated:

- `apps/api/.env.local` — `CLERK_SECRET_KEY` (the only file that carries it)
- `apps/extension/.env` or `apps/extension/.env.local` — `WXT_CLERK_SYNC_HOST` and `WXT_CLERK_PUBLISHABLE_KEY`
- Test user/org identity comes from `apps/dashboard/e2e/constants.ts` (`TEST_USER_EMAIL`, `TEST_USER_PASSWORD`, `TEST_ORG_NAME`). Same fixture user the dashboard E2E suite uses — provisioned idempotently at first run. Override with `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` if you want a private user.

Dashboard must be running so `syncHost` can serve the sign-in ticket redemption:

```
pnpm --filter @remarks/dashboard dev
```

## Run

```
pnpm --filter @remarks/extension verify            # all specs
pnpm --filter @remarks/extension verify:auth       # auth-flow.spec.ts only
pnpm --filter @remarks/extension verify:screenshot # screenshot-preview.spec.ts only
```

The script builds the extension first (so `.output/chrome-mv3/` is current), then launches headed Chromium. Expect a browser window for ~30 seconds. Pass = all assertions green.

## What it verifies

1. Service worker boots without throwing (catches `createClerkClient({ background: true })` init regressions — e.g. missing `cookies` permission shows up as a thrown error here).
2. Sign-in-ticket redemption on `syncHost` seeds the Clerk session that `createClerkClient({ background: true })` picks up.
3. `readAuthStatus()` (invoked directly via `sw.evaluate` — see note below) returns `{ signedIn: true, token: "<JWT>", clerkOrgId: "<org_...>" }`.
4. The returned token is a well-formed Clerk JWT (three segments, `sub` matches the test user, `exp` in the future, `iss` contains "clerk").
5. The popup's `<ActiveOrgSync />` effect writes `chrome.storage.local:remarks.activeClerkOrgId` after Clerk loads.
6. No error-level console messages from the service worker during the flow.

### Why `sw.evaluate` instead of `chrome.runtime.sendMessage`

Playwright 1.59 doesn't reliably dispatch `chrome.runtime.sendMessage` from a popup page to an MV3 service worker under `launchPersistentContext` + `--load-extension`. The message lands, the SW is alive, but the `onMessage` listener never fires. To exercise the architecture regardless, `apps/extension/src/entrypoints/background.ts` exposes `readAuthStatus` on `globalThis.__remarksReadAuthStatus` and the spec calls it via `sw.evaluate()`. Shipping the hook in the bundle is harmless in production (nothing reads from it).

## What it doesn't verify

- The 60-second token-refresh cadence (doable with a long sleep; verify manually if suspicious).
- `clerk.addListener` pushing `auth-status-changed` on sign-out (requires a second browser context; deferred).
- tRPC calls against a live API (a `200` there proves the Bearer is valid; covered by the API's own integration tests + dashboard E2E).
- Firefox (MV2) — covered by `wxt build -b firefox` at build time; auth flow is Chromium-only.

## Troubleshooting

- **"Service worker never registered"**: the extension failed to load. Check `apps/extension/.output/chrome-mv3/` exists and is fresh; `verify:auth` should have rebuilt it.
- **"Timeout waiting for ActiveOrgSync"**: the dashboard `syncHost` isn't running, or the `__clerk_ticket` expired (single-use, ~1-minute validity).
- **`CLERK_SECRET_KEY missing`**: `apps/api/.env.local` isn't populated. Follow `docs/runbooks/setup.md`.
