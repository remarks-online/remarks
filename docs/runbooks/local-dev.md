# Runbook: Local dev environment

Day-to-day reference for running the Remarks stack on your machine: which services run where, how to start them, how to seed data, how to test the extension end-to-end, and how to recover when something is wrong.

For first-time machine bootstrap (installing Node/pnpm, creating Clerk/Neon/Cloudflare accounts, copying `.env.example` files, applying initial migrations) see `docs/runbooks/setup.md`. This doc assumes that's done.

## Service topology

```
┌─ apps/extension ──────────┐         ┌─ apps/dashboard ─────────┐
│  WXT dev server           │         │  Next.js                 │
│  127.0.0.1:3030           │  ───>   │  http://localhost:3000   │  ──> Clerk (hosted)
│  (HMR/reload websocket)   │ syncHost│  /sign-in, project pages │
└──────────┬────────────────┘         └────────────┬─────────────┘
           │ tRPC + Bearer JWT                     │ tRPC (server + browser)
           ▼                                       ▼
       ┌─ apps/api ──────────────────────────────────────────────┐
       │  Fastify  http://localhost:4000                         │
       │  /health, /trpc, /webhooks/clerk                        │
       └──────┬─────────────────────────────┬────────────────────┘
              │                             │
              ▼                             ▼
      ┌─ Postgres (Neon dev) ─┐     ┌─ R2 (or MinIO) ───────────┐
      │  remarks_dev branch   │     │  remarks-screenshots-dev  │
      │  via direct endpoint  │     │  or http://localhost:9000 │
      └───────────────────────┘     └───────────────────────────┘

apps/mcp runs at localhost:4001 (scaffold; Phase 2 — no HTTP yet).
```

| Service | Where it runs | Started by | Required for |
|---|---|---|---|
| **api** (Fastify) | `localhost:4000` | `pnpm dev` | dashboard tRPC calls, extension tRPC calls, Clerk webhooks |
| **dashboard** (Next.js) | `localhost:3000` | `pnpm dev` | sign-in UI, project views, **extension Clerk session sync** |
| **extension** (WXT) | `127.0.0.1:3030` (HMR), loaded into Chrome | `pnpm dev` | the actual product |
| **mcp** | `localhost:4001` (scaffold only) | `pnpm dev` | nothing yet (Phase 2) |
| **Postgres** | Neon dev branch (cloud) | already running | api, migrations, seed |
| **R2** | Cloudflare (cloud) | already running | api screenshot upload/serve in normal dev |
| **MinIO** | `localhost:9000` (Docker, optional) | `pnpm minio:up` | integration tests, offline R2 work |
| **Clerk** | hosted | already running | all auth |

## Daily startup

```sh
nvm use                 # Node 22 per .nvmrc — only needed if you switch projects in this shell
pnpm install            # only if package.json changed since you last pulled
pnpm dev                # starts api + dashboard + mcp + extension via Turbo
```

Expected logs from `pnpm dev` (in any order — Turbo runs them in parallel):

- **api** — `"server listening at http://0.0.0.0:4000"`. Crashes immediately if `DATABASE_URL` is wrong or Neon is unreachable.
- **dashboard** — `- Local:        http://localhost:3000`.
- **mcp** — one `{"msg":"mcp scaffold — Phase 2 implementation pending"}` line, then idle.
- **extension** — WXT writes `apps/extension/.output/chrome-mv3-dev/` and watches.

To run a single app: `pnpm --filter @remarks/{api|dashboard|mcp|extension} dev`. Note that the extension is **not useful in isolation** — see "Extension end-to-end" below.

## Loading the extension into Chrome

One-time per machine:

1. `chrome://extensions` → toggle **Developer mode** on.
2. **Load unpacked** → select `apps/extension/.output/chrome-mv3-dev/`.
3. The extension ID is deterministic (derived from `CRX_PUBLIC_KEY` in `apps/extension/wxt.config.ts`): **`baikikfefeheiildmfoaicbjbnbecgjd`**.

WXT rebuilds on file changes; the loaded extension auto-reloads via the websocket on `127.0.0.1:3030`. If you ever see `[wxt] Failed to connect to dev server` in the popup console, the WXT process isn't running or you loaded a stale build — restart `pnpm --filter @remarks/extension dev` and click the reload icon next to **Remarks** in `chrome://extensions`.

## Extension end-to-end (sign-in flow)

The extension does **not** own a Clerk session — it reads the dashboard's. To sign in via the popup you need three things alive at the same time:

1. **Dashboard running** at `http://localhost:3000` (it's the syncHost the popup reads from).
2. **API running** at `http://localhost:4000` (the popup hits `/trpc/*` with the Bearer JWT).
3. **Clerk allowlist** has the extension's chrome-extension origin. **One-time per Clerk instance**:

   ```sh
   pnpm --filter @remarks/scripts exec tsx clerk-allowlist-extension.ts baikikfefeheiildmfoaicbjbnbecgjd
   ```

   Adds `chrome-extension://baikikfefeheiildmfoaicbjbnbecgjd` to the dev Clerk instance's `allowed_origins`. Idempotent. Requires `CLERK_SECRET_KEY` in your shell. Full background in `docs/runbooks/extension-clerk-synchost.md`.

If clicking **Sign in** in the popup opens `http://localhost:3000/sign-in` and you get "site can't be reached", the dashboard isn't running. Start `pnpm --filter @remarks/dashboard dev` (or `pnpm dev` at root).

## Postgres operations

Neon hosts your dev DB. Common tasks:

```sh
# Apply any new migrations after pulling main
pnpm --filter @remarks/db run db:migrate

# Open a browser table inspector against DATABASE_URL in packages/db/.env
pnpm --filter @remarks/db run db:studio

# Reset the Neon `dev` branch from main and re-run all migrations.
# Use after pulling new migrations or when dev schema drifted.
# Requires: neonctl + jq installed; auto-detects org/project (or set
# NEON_ORG_ID / NEON_PROJECT_ID).
pnpm db:dev:reset
```

`db:dev:reset` rewrites `apps/api/.env.local`'s `DATABASE_URL` to the freshly-reset branch endpoint, so restart `pnpm dev` (or just the api) afterwards.

## Seeding dev data

`pnpm seed` populates an org / user / project / branches / annotations against your local DB so the dashboard project pages look real without using the extension.

```sh
DEV_SEED_CLERK_ORG_ID=org_…  DEV_SEED_CLERK_USER_ID=user_…  pnpm seed
```

Get the IDs from `dashboard.clerk.com` → your dev instance → the org and user you signed in with. Idempotent — re-run safely after schema changes. If you also export the `R2_*` vars, one annotation gets a real screenshot uploaded; otherwise it skips that step gracefully. See `tools/scripts/seed.ts` for the full schema of what it inserts.

## MinIO (optional — for offline R2 / integration tests)

Real dev uses Cloudflare R2; you only need MinIO if you want to run integration tests or work offline.

```sh
pnpm minio:up           # starts MinIO at http://localhost:9000 (creds: minioadmin/minioadmin)
pnpm minio:down         # stops it
```

To run api integration tests against MinIO + your local Postgres:

```sh
cd apps/api
set -a && source .env.local && set +a
export R2_S3_ENDPOINT=http://localhost:9000
pnpm vitest run --config vitest.integration.config.ts
```

These tests **truncate every table** in your `DATABASE_URL` between cases — point at a dev DB, never prod. The integration harness lives at `apps/api/test/integration/`.

## Verification

Quick smoke checks while `pnpm dev` is running:

```sh
curl -sI http://localhost:4000/health   | head -1   # → HTTP/1.1 200 OK
curl -sI http://localhost:3000          | head -1   # → HTTP/1.1 200 OK or 307 → /sign-in
lsof -nP -iTCP:3030 -sTCP:LISTEN                    # → 127.0.0.1:3030 (WXT)
```

Static checks (no servers needed) — the same set CI runs:

```sh
pnpm turbo typecheck --filter="*"
pnpm turbo lint --filter="*"
pnpm turbo test --filter="*"
pnpm turbo build --filter="*"
```

Extension dev-tools console (open from the popup): `[wxt] Connected to dev server` should appear. The Clerk popup UI should render — not a blank box.

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Popup console: `WebSocket connection to 'ws://localhost:3000/' failed` | You loaded an extension build from before the WXT port pin | Re-run `pnpm --filter @remarks/extension dev`, then click reload in `chrome://extensions`. WXT now serves on 3030. |
| Popup is blank white | `WXT_CLERK_PUBLISHABLE_KEY` missing or unprefixed | Set it in `apps/extension/.env`. WXT only injects vars with the `WXT_` prefix. |
| Popup → Sign in opens "site can't be reached" | Dashboard not running | `pnpm --filter @remarks/dashboard dev` (or `pnpm dev` at root). |
| Popup signs in but tRPC calls fail with 401 | Extension origin not in Clerk allowlist | Run `clerk-allowlist-extension.ts` (see "Extension end-to-end"). |
| api crashes on boot with `connection refused` / `ECONNREFUSED` | `DATABASE_URL` wrong or Neon branch suspended | Check Neon console; for a stale dev branch run `pnpm db:dev:reset`. |
| `db:migrate` hangs or rejects the connection | You're using the Neon **pooled** endpoint | Switch `DATABASE_URL` to the direct (non-`-pooler`) host in both `apps/api/.env.local` and `packages/db/.env`. |
| `EADDRINUSE :::3000` from api or mcp on `pnpm dev` | Their `.env.local` was never created, so Zod fell back to default port 3000 | `cp apps/{api,mcp}/.env.example apps/{api,mcp}/.env.local`. |
| `EADDRINUSE` on 3030 from extension | A stale `wxt` process is still running | `pkill -f 'wxt.mjs'` then restart. |
| Integration tests fail with R2 errors | MinIO isn't running, or `R2_S3_ENDPOINT` not exported | `pnpm minio:up` and re-export `R2_S3_ENDPOINT=http://localhost:9000`. |
| Turbo complains about stale outputs after a branch switch | Cached outputs reference deleted files | `pnpm -w exec turbo run build --force` once. |

## Tearing down

```sh
# In the pnpm dev terminal — stops api, dashboard, mcp, extension
Ctrl-C

# Optional: stop MinIO if you started it
pnpm minio:down
```

There's no cleanup needed beyond that. Neon dev data persists across sessions; use `pnpm db:dev:reset` to wipe it deliberately. The loaded extension stays in Chrome until you remove it from `chrome://extensions`; that's harmless.

## See also

- `docs/runbooks/setup.md` — first-time machine bootstrap (install tooling, accounts, env files, initial migrations).
- `docs/runbooks/environments.md` — which secret lives where across dev/preview/prod.
- `docs/runbooks/extension-clerk-synchost.md` — deep dive on the extension's Clerk session sync flow.
- `docs/runbooks/deploy-dashboard.md` — Vercel deployment of the dashboard.
- `CLAUDE.md` §1.11 — exact verification commands to run before declaring a task done.
