# Extension E2E tests (task 1.31)

Playwright happy-path suite that loads the built MV3 extension into a real Chromium and exercises the popup and the page-injected sidebar shadow root. **Runs in CI.**

The companion suite `apps/extension/verify/` is local-only architectural verification (auth-flow handshake, screenshot crop) — it stays out of CI on purpose. This suite is the CI-payable happy path; keep it small.

## Specs

- `popup-signed-out.spec.ts` — popup shows sign-in CTAs when no Clerk session is present.
- `popup-signed-in.spec.ts` — popup surfaces the project picker for a signed-in user with the seeded project.
- `sidebar-injection.spec.ts` — content script mounts the `<remarks-sidebar>` shadow root and renders the signed-out shell on host pages.

## Running locally

```bash
# Reset the dev DB and apply migrations (destructive to dev-branch data).
pnpm db:dev:reset

# Builds the extension, then starts API + dashboard via Playwright's webServer
# config and runs every *.spec.ts.
pnpm --filter @remarks/extension test:e2e
```

Env comes from these files (loaded by `playwright.config.ts`):

- `apps/extension/.env` — `WXT_*` defaults (committed).
- `apps/extension/.env.local` — optional overrides.
- `apps/api/.env.local` — `CLERK_SECRET_KEY` and `DATABASE_URL`.

The webServer block boots `pnpm --filter @remarks/api dev` on `:4000` and `pnpm --filter @remarks/dashboard dev` on `:3000`. Both honour `reuseExistingServer: true`, so a stale dev server with outdated env keeps running silently — `pkill -f "next dev"` and `pkill -f "tsx.*api"` if a spec fails with auth errors.

## How sign-in works (read this before adding specs)

Same `__clerk_ticket` redemption pattern as `apps/dashboard/e2e/`. **Don't drive the Clerk sign-in UI** — dev instances layer on device verification and OTP gates that the ticket flow bypasses entirely. The `signedInExtensionContext` fixture mints a fresh ticket, navigates the extension's persistent context to `${WXT_CLERK_SYNC_HOST}/sign-in?__clerk_ticket=…`, waits for the redirect off `/sign-in`, then pins the active org via `window.Clerk.setActive`. The popup's `ClerkProvider syncHost={…}` picks up the resulting session via `chrome.storage` shared with the SW client.

```ts
import { test, expect, EXT_ID } from "./fixtures";

test("my new scenario", async ({ signedInExtensionContext }) => {
  const popup = await signedInExtensionContext.context.newPage();
  await popup.goto(`chrome-extension://${EXT_ID}/popup.html`);
  await expect(popup.getByText("…")).toBeVisible();
});
```

`extensionContext` is the same launcher minus the ticket redemption — use it for signed-out specs.

## Layout

- `playwright.config.ts` — testDir, env loading, webServer for API + dashboard, headed Chromium.
- `global-setup.ts` — fails fast if the extension hasn't been built, then delegates to `apps/dashboard/e2e/global-setup.ts` to provision the fixture user/org/project. The Clerk identity (`TEST_USER_EMAIL`, `TEST_ORG_NAME`, `TEST_PROJECT_NAME`) is shared with the dashboard suite — a single source of truth, mirroring the precedent from `apps/extension/verify/auth-flow.spec.ts`.
- `fixtures.ts` — `extensionContext` (launches `chromium.launchPersistentContext` with `--load-extension`) and `signedInExtensionContext` (extends it with ticket redemption + active-org pin). `EXT_ID` exported here too — pinned via `wxt.config.ts`'s `CRX_PUBLIC_KEY`.
- `tsconfig.json` — same shape as `apps/extension/verify/tsconfig.json`; Bundler resolution + Playwright types.

## What this suite intentionally doesn't cover

- **Annotation creation end-to-end** (capture → presign → PUT to R2 → POST `/annotations` → sidebar thread reflects). Crosses every Phase 1 surface; tracked as future work below.
- **Clerk sign-in / sign-out UI flows** — the ticket-redemption fixture is the canonical shortcut. Drive the UI only when the spec is explicitly about it.
- **Element / rectangle picker keyboard shortcuts** — flaky against shadow-root focus boundaries; covered by `apps/extension/src/lib/picker-controller.test.ts` at the unit layer.
- **Service-worker auth handshake / screenshot crop** — these live in `apps/extension/verify/` and stay out of CI. The split is intentional; preserve it.
- **Firefox / MV2** — `wxt build -b firefox` runs at build time; doubling the Playwright matrix isn't worth the cost yet.

## Future work

- **Annotation submit path** — the highest-value next spec. Needs MinIO running on `:9000` (CI already runs it for integration tests; e2e job would adopt the same step) and a way to trigger the picker from outside the shadow root. Probably a programmatic dispatch via `chrome.runtime.sendMessage` rather than keyboard simulation.
- **Storage-state reuse** — pre-redeemed Clerk session persisted to disk would shave ~3s/spec. Not worth it at three specs.
- **Parallelism** — currently `workers: 1`. Unlocking it requires per-test isolation in the shared dev DB; the dashboard suite has the same constraint.

## Gotchas

- **MV3 SW + headless** — service workers don't register reliably under headless Chromium. The fixture launches headed, and CI wraps with `xvfb-run`.
- **`.user-data` dirs** — `fixtures.ts` writes to `apps/extension/test-results/e2e-user-data/<workerIndex>-<testId>/`. Already covered by the repo-root `.gitignore`'s `test-results/` rule.
- **Stale extension build** — if a spec fails with "service worker never registered", the unpacked extension at `apps/extension/.output/chrome-mv3/` is missing or stale. The `test:e2e` script always rebuilds; if you're invoking Playwright directly, run `pnpm --filter @remarks/extension build` first. `global-setup.ts` errors with a clear message if the build is absent.
- **Pinned extension ID** — `EXT_ID = baikikfefeheiildmfoaicbjbnbecgjd` is fixed by the committed `CRX_PUBLIC_KEY` in `wxt.config.ts`. Don't hard-code a different id; if you regenerate the keypair, update both files at once.
