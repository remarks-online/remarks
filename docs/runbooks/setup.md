# Runbook: Set up your local dev environment

First-time setup for a fresh clone of this monorepo. Covers Task 0.20 from `docs/plan/remarks-phase-0-1-spec.md`. Follow in order — step 3 depends on the accounts from step 1, step 4 depends on env files from step 3, step 5 depends on the Neon migration from step 4.

The target end-state: `pnpm dev` at the repo root brings up `apps/api`, `apps/dashboard`, `apps/mcp`, and `apps/extension` in parallel without crashing, and the three verification checks at the end pass.

Prerequisites (the "bring your own" list):

- **Clerk `remarks-dev` instance** — used by dashboard, extension, and the api webhook. Created in Task 0.1 (spec §8.1).
- **Neon project with a dev branch** — used by api and `packages/db` for migrations. Created in Task 0.1.
- **Chrome or Chromium** — needed to load the extension unpacked.

Account signup for Clerk, Neon, Cloudflare, etc. is explicitly covered by spec §8.1 and Task 0.1. Don't do it from this doc.

## 1. Install tooling

```sh
node -v          # → v22.x (matches .nvmrc)
pnpm -v          # → 10.24.0 (matches packageManager in root package.json)
```

If either is wrong or missing:

- **Node 22 LTS** — install via `nvm` (`nvm install && nvm use` reads `.nvmrc`). Anything older than 22 breaks native module builds.
- **pnpm 10.24.0** — enable Corepack (bundled with Node 22) and pin the right version:

  ```sh
  corepack enable
  corepack prepare pnpm@10.24.0 --activate
  ```

  `npm` and `yarn` are banned by `CLAUDE.md` §1.1 — don't reach for them as a workaround.

No other global tools are required. Biome, Turbo, TypeScript, `drizzle-kit`, and `tsx` are all workspace devDependencies and run through `pnpm` scripts.

## 2. Clone and install

```sh
git clone git@github.com:remarks-online/remarks.git
cd remarks
nvm use                 # confirm Node 22 per .nvmrc
pnpm install            # installs all workspaces
```

There are no `simple-git-hooks` or `husky` hooks wired up yet, so nothing to run after install. Biome runs at CI-time rather than pre-commit for now.

## 3. Configure env files

Every app that reads `process.env` parses it through a Zod schema at boot (`CLAUDE.md` §1.8). A missing or invalid value crashes the app with a readable error — that's intentional.

Copy each `.env.example` to the right local file. For Node apps use `.env.local`; for Next.js and WXT follow the framework convention:

```sh
cp apps/api/.env.example        apps/api/.env.local
cp apps/dashboard/.env.example  apps/dashboard/.env.local
cp apps/extension/.env.example  apps/extension/.env
cp apps/mcp/.env.example        apps/mcp/.env.local
cp packages/db/.env.example     packages/db/.env
```

Then fill in the values that can't be checked in. The example files ship with sensible defaults for everything non-secret (ports, `NODE_ENV`, `LOG_LEVEL`, `HOST`, the api URL the extension talks to), so you only need to touch the rows below:

| File | Variable | Where to get it |
|---|---|---|
| `apps/api/.env.local` | `DATABASE_URL` | Neon console → your dev branch → **direct** endpoint (not the `-pooler` host). Drizzle disables prepared statements, but `drizzle-kit` and migrations don't like pgbouncer. |
| `apps/api/.env.local` | `CLERK_WEBHOOK_SECRET` | Clerk dashboard → Webhooks → your endpoint → Signing Secret (starts `whsec_`). For boot-only local work, `whsec_dev_placeholder` works — the webhook route only rejects bad signatures at request time. Real webhook testing needs ngrok; out of scope here. |
| `apps/dashboard/.env.local` | `CLERK_SECRET_KEY` | Clerk `remarks-dev` → API keys → `sk_test_…` (never `sk_live_`). |
| `apps/dashboard/.env.local` | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk `remarks-dev` → API keys → `pk_test_…`. Public; safe in the browser bundle. |
| `apps/extension/.env` | `WXT_CLERK_PUBLISHABLE_KEY` | Same `pk_test_…` as dashboard. WXT requires the `WXT_` prefix for env injection. |
| `packages/db/.env` | `DATABASE_URL` | Same Neon direct endpoint as `apps/api/.env.local`. `drizzle-kit` reads this file for `db:generate` / `db:migrate` / `db:studio`. |

Ports are pre-assigned in the examples to avoid the three-way collision on 3000: api is `4000`, mcp is `4001`, dashboard keeps `3000` (its `next dev -p 3000` is hardcoded). Change only if one of those ports is already in use on your machine.

## 4. Run database migrations

```sh
pnpm --filter @remarks/db run db:migrate
```

This executes `packages/db/src/migrate.ts` against `DATABASE_URL` and applies every migration in `packages/db/drizzle/` (generated in Task 0.10). Expected: the run ends cleanly and you can see the tables in Neon → your dev branch → **Tables**.

For throw-away schema iteration there's also `db:push` (diff-and-apply with no migration file), but default to `db:migrate` so your local state matches what CI and prod will apply.

## 5. Start the dev loop

```sh
pnpm dev
```

`turbo run dev` fans out to all four apps in parallel (`dev` is marked `persistent` + no-cache in `turbo.json`). Expected output, approximately:

- **api** — Fastify logs `"server listening at http://0.0.0.0:4000"`. On boot it also opens a pooled Postgres connection; if `DATABASE_URL` is wrong or unreachable, the process dies here with a clear error.
- **dashboard** — Next logs `- Local:        http://localhost:3000`.
- **mcp** — emits a scaffold JSON line (`{"msg":"mcp scaffold — Phase 2 implementation pending", ...}`) and stays alive under `tsx watch`. There is no HTTP server yet; the `PORT` env is declared for Phase 2.
- **extension** — WXT writes the unpacked build to `apps/extension/.output/chrome-mv3/` and watches for changes. Chrome → `chrome://extensions` → enable Developer mode → **Load unpacked** → that directory. Reload the extension when WXT rebuilds.

To run a single app only: `pnpm --filter @remarks/api dev` (or `@remarks/dashboard` / `@remarks/mcp` / `@remarks/extension`).

## 6. Verification (done-when)

Run these checks; if any fails, stop and debug before marking Task 0.20 done.

```sh
# Static health — mirrors .github/workflows/ci.yml (`check` job)
pnpm turbo run lint typecheck test

# Live health (with `pnpm dev` still running in another terminal)
curl -sI http://localhost:4000/health | head -1   # → HTTP/1.1 200 OK
curl -sI http://localhost:3000         | head -1   # → HTTP/1.1 200 OK (or 307 redirect to /sign-in)
```

The extension:

- `chrome://extensions` shows **Remarks** loaded from the unpacked path with no errors.
- Click the extension icon → the popup renders the Clerk sign-in UI (not a blank white box).

Signing up an end-to-end Clerk user and seeing the row land in Neon `users` is **not** part of this setup — that verifies Task 0.16 and requires ngrok to bridge the webhook to your local api. See the Task 0.16 runbook (forthcoming) for that flow.

## Recovery / common failures

- **`EADDRINUSE :::3000`** from api or mcp → you skipped `cp .env.example .env.local` for that app, so the Zod default of 3000 kicked in instead of the example's `PORT=4000` / `4001`. Create the file.
- **`ZodError: CLERK_SECRET_KEY`** at dashboard boot → env file is named `.env` instead of `.env.local`; Next's dev server reads `.env.local` by default. Rename.
- **Extension popup renders blank** → `WXT_CLERK_PUBLISHABLE_KEY` is missing or not prefixed `WXT_`. WXT only injects env vars matching the `WXT_` prefix into `import.meta.env`.
- **`db:migrate` hangs or throws `connection refused`** → you're using the Neon **pooled** endpoint. Switch `DATABASE_URL` to the direct (non-`-pooler`) host in both `apps/api/.env.local` and `packages/db/.env`.
- **api dies on boot with a DB error** → `DATABASE_URL` is invalid or the Neon branch is suspended. Confirm by loading Neon console → SQL Editor and running `select 1;` against the same branch.
- **`pnpm install` fails on native modules** → Node is not 22. `nvm use` (or `nvm install`) and retry.
- **Turbo complains about stale outputs** → `pnpm -w exec turbo run build --force` once, then re-run normal commands. (Rare; usually only hits after switching branches with conflicting `dist/` state.)
