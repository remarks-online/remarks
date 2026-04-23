# Dashboard E2E tests

Playwright specs that drive a real browser through the Next.js dashboard + Fastify API + Postgres + Clerk. Specs live beside this file (`*.spec.ts`); setup and helpers live here too.

## Running

```bash
# Reset the Neon `dev` branch + apply migrations. Destructive to dev-branch data.
pnpm db:dev:reset

# Runs global setup (Clerk + DB), starts the API + dashboard via Playwright's
# `webServer`, runs every *.spec.ts, tears servers down.
pnpm --filter @remarks/dashboard test:e2e
```

Env comes from `apps/dashboard/.env.local` and `apps/api/.env.local` — Playwright loads both (see `playwright.config.ts`). You need a valid `CLERK_SECRET_KEY` (must start with `sk_test_`; production keys are rejected in `global-setup.ts`), `DATABASE_URL`, and the standard dashboard `NEXT_PUBLIC_*` keys.

## One-time Clerk dev-instance setup

The fixture user + org flow depends on **organizations being enabled** on the Clerk dev instance. If you've spun up a fresh Clerk app and the test fails with `organization_not_enabled_in_instance`, run:

```bash
curl -s -H "Authorization: Bearer $CLERK_SECRET_KEY" \
  -X PATCH https://api.clerk.com/v1/instance/organization_settings \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

That flips a persistent instance setting — you should never need to run it again for the same Clerk app.

## The sign-in-token pattern (read this before adding specs)

**Don't drive the Clerk sign-in UI.** It's tempting to type an email, then a password, then click through — but dev instances layer on device verification, per-instance MFA policy, and email-OTP gates you can't always disable. You'll spend the afternoon chasing selectors.

Use Clerk's Backend API to mint a **sign-in token** per test and redeem it at `/sign-in?__clerk_ticket=<token>`. Clerk consumes the ticket, sets the session cookies, and redirects off the sign-in page. No UI interaction, no MFA, no OTPs. The `signedInPage` fixture in `fixtures.ts` does this for you:

```ts
import { test, expect } from "./fixtures.js";

test("my new scenario", async ({ signedInPage }) => {
  await signedInPage.goto("/app/some-route");
  await expect(signedInPage.getByText("something")).toBeVisible();
});
```

Tokens are single-use and short-lived, so the fixture mints a fresh one per test.

## Layout

- `constants.ts` — fixture user/org/project identifiers. Shared between global-setup and specs so they agree on what's seeded.
- `clerk.ts` — stateless Backend API wrappers: `ensureClerkUser`, `ensureClerkOrg`, `mintSignInToken`. Import from specs or from global-setup; don't reach into `fetch` directly.
- `global-setup.ts` — runs once per `test:e2e` invocation. Idempotently ensures the Clerk fixture user + org exist, seeds the matching DB rows (mirroring what the Clerk webhook would sync), and hands the IDs to fixtures via `process.env.E2E_CLERK_USER_ID` / `E2E_CLERK_ORG_ID`. Does **not** mint a sign-in token — that's per-test.
- `fixtures.ts` — `signedInPage` fixture that redeems a fresh ticket and yields a `Page` already in a signed-in state. Also re-exports `expect` so specs only import from this file.
- `*.spec.ts` — the specs.

## Adding a new spec

1. Decide whether the default fixture user + seeded project are enough. If yes, just write the spec against `signedInPage`.
2. If you need additional DB state (a second project, an annotation, etc.), add a narrow helper that inserts only what this spec needs — **don't** expand `global-setup.ts` with project-specific seeding, or every spec pays the cost.
3. If you need a *different* Clerk user (admin vs. member tests), call `ensureClerkUser` + `mintSignInToken` yourself and redeem the ticket in a `test.beforeEach`. The fixture user is not a singleton; it's just a convenient default.

## Clerk dev magic (for the UI path, if you ever need it)

Occasionally you'll want to exercise a flow the sign-in-token bypasses — a password reset UI, a sign-up form, etc. Clerk dev instances recognize a few magic patterns:

- **Test emails**: any address matching `*+clerk_test@*` (e.g., `alice+clerk_test@example.com`) is a test address.
- **Bypass OTP**: the code `424242` is accepted in place of any real verification code for test emails.
- **Test phone numbers**: `+15555550100` through `+15555550199` with the same `424242` OTP.

These matter for sign-up flows (which mint the session fresh). For sign-in, keep using the ticket.

## Future work

Flagged but not yet implemented — revisit when the spec count grows.

- **Storage-state reuse**: `use.storageState` + a global-setup step that saves cookies once can shave ~3s/spec. Meaningless at one spec; worth it around 3+.
- **Test-data isolation**: the fixture user/org/project is shared across runs. Fine for read-only assertions; once specs start mutating state (creating projects, deleting things), either teardown per-test or generate unique IDs per run.
- **CI integration**: `test:e2e` doesn't run in GitHub Actions yet. Needs Chromium install (`--with-deps` in the apt-based runner), env secrets wired into the workflow, and a CI-only Neon branching strategy so parallel PRs don't stomp each other's data.
- **Parallelism**: currently `workers: 1` / `fullyParallel: false`. Fine at one spec, limiting at many. Unlocking it requires test isolation (above) first.

## Gotchas worth internalizing

- **`reuseExistingServer: true`** in `playwright.config.ts` means a stale dashboard dev server with outdated env vars will silently keep running. If a spec fails with Zod env-validation errors, `pkill -f "next dev"` and re-run.
- **Dashboard needs `NEXT_PUBLIC_API_BASE_URL`** in `.env.local` — it's in `.env.example` but not always copied over. If `/app/projects` renders a `Runtime ZodError` about `NEXT_PUBLIC_API_BASE_URL`, that's the cause.
- **Neon compute endpoints rotate**. If you get `The requested endpoint could not be found` connecting to Postgres, run `pnpm db:dev:reset` — it re-queries the current endpoint via `neonctl` and rewrites `apps/api/.env.local`.
