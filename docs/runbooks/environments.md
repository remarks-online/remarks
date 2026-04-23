# Runbook: Environment tiers

Single authoritative map of which secret goes where. Phase 0/1 runs on two tiers: **dev** (local laptops + Vercel preview/development) and **prod** (Fly `remarks-api` + Vercel production). The `staging` Neon branch exists (§8.5 of the spec) but no staging compute is deployed — treat staging as latent.

## Tier-to-service matrix

| Tier | Runs on | Clerk | Neon branch + endpoint | R2 bucket |
|---|---|---|---|---|
| **Dev** | local machines (`pnpm dev`) + Vercel Preview + Vercel Development + CI | `remarks-dev` (`pk_test_…` / `sk_test_…`) | `dev` branch, **direct** endpoint (non-pooler) | `remarks-screenshots-dev` |
| **Prod** | Fly `remarks-api` + Vercel Production (`remarks-dashboard`) | `remarks-prod` (`pk_live_…` / `sk_live_…`) | `main` branch, **pooled** endpoint (`-pooler`) | `remarks-screenshots-prod` |
| CI integration tests | GitHub Actions `check` job | test placeholders (mocked at the SDK layer) | Postgres 16 service container | MinIO service container, `remarks-screenshots-test` bucket |

Constants shared by both tiers (non-secret):

- Cloudflare R2 account ID: `1a140b2e60339b2e99adf1f450569681`
- Neon project: `fragrant-mode-48800997` (org `org-lively-brook-15087440`)
- Vercel team: `remarks`, project: `remarks-dashboard` (`prj_BsiAL1DyZCojmpFFngJuaUUoWioL`)
- Fly app: `remarks-api` (org `remarks`)

## Secret locations by variable

| Variable | Dev value lives in | Prod value lives in | Owner of rotation |
|---|---|---|---|
| `DATABASE_URL` | `apps/api/.env.local`, `packages/db/.env` (both Neon `dev` direct) | Fly secret (Neon `main` pooled) | Neon console → dev/main branch → Connection string |
| `CLERK_SECRET_KEY` | `apps/api/.env.local`, `apps/dashboard/.env.local`, Vercel Preview + Development | Fly secret, Vercel Production | Clerk dashboard → remarks-dev / remarks-prod → API keys |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `apps/dashboard/.env.local`, Vercel Preview + Development | Vercel Production | Clerk dashboard → remarks-dev / remarks-prod → API keys |
| `WXT_CLERK_PUBLISHABLE_KEY` | `apps/extension/.env` (mirrors the publishable key above) | not applicable — Phase 1 ships unsigned dev extensions | — |
| `CLERK_WEBHOOK_SECRET` | `apps/api/.env.local` | Fly secret | Clerk dashboard → Webhooks → endpoint → Signing Secret |
| `R2_ACCOUNT_ID` | `apps/api/.env.local` (= account id constant) | Fly secret (same constant) | — (immutable) |
| `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` | `apps/api/.env.local` (dev-bucket-scoped token) | Fly secret (prod-bucket-scoped token) | Cloudflare dashboard → R2 → Manage R2 API Tokens |
| `R2_BUCKET_SCREENSHOTS` | `apps/api/.env.local` = `remarks-screenshots-dev` | Fly secret = `remarks-screenshots-prod` | — (immutable) |

## How the dev tier is configured

**Local machines.** Four env files, all gitignored:

- `apps/api/.env.local` — API runtime. Populated by `docs/runbooks/setup.md` step 3; see that doc for per-variable sourcing.
- `apps/dashboard/.env.local` — dashboard dev server (`next dev`).
- `apps/extension/.env` — WXT build-time injection. Must use the `WXT_` prefix.
- `packages/db/.env` — drizzle-kit only (`db:generate`, `db:migrate`, `db:studio`). Must be the Neon direct (non-pooler) endpoint — pgbouncer breaks drizzle-kit migrations.

**Vercel Preview + Development.** `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` set to the `remarks-dev` test keys. Verify with `vercel env ls preview` / `vercel env ls development` from `apps/dashboard/`. Missing context: the dashboard's API base URL isn't wired up yet — preview deploys currently have no backing API. Out of scope for Phase 1 task 1.6; track as a known gap.

**CI integration tests.** `.github/workflows/ci.yml` spins up Postgres + MinIO service containers and injects R2 + Postgres env vars into the `test:integration` step. No real Clerk, Neon, or Cloudflare credentials required. Unit tests don't need any of this.

## How the prod tier is configured

**Fly `remarks-api` secrets.** Set with `flyctl secrets set KEY=value --app remarks-api`. Required (enforced by `apps/api/scripts/check-fly-secrets.ts` on every deploy):

```
DATABASE_URL, CLERK_SECRET_KEY, CLERK_WEBHOOK_SECRET,
R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_SCREENSHOTS
```

Pipe the Neon prod connection string directly without echoing:

```bash
flyctl secrets set \
  "DATABASE_URL=$(neonctl connection-string main --project-id fragrant-mode-48800997 --pooled)" \
  --app remarks-api --stage
```

The `--stage` flag applies the secret on the next deploy instead of restarting immediately.

**Vercel Production.** `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` set to the `remarks-prod` live keys. Vercel CLI gotcha: `vercel env rm NAME preview` removes the variable record **across all environments** if one record covers multiple targets — use the REST API (`POST /v10/projects/{id}/env?upsert=true`) for per-target writes so you don't have to re-add Production after each rotation.

## How to rotate a secret

1. **Generate the new value** in the owning dashboard (Clerk / Neon / Cloudflare).
2. **Replace prod first** — `flyctl secrets set` or `vercel env add --force` (or REST upsert). Production apps restart.
3. **Replace dev** — rewrite the local env file and any Vercel Preview/Development value.
4. **Revoke the old value** in the owning dashboard. Do not skip this step.
5. If the secret is consumed by a running service, verify it picked up the new value (`flyctl ssh console` + check env, or a health-check request that exercises the secret path).

## Known gaps (Phase 1, current state)

1. **Prod Clerk webhook is not wired.** Fly's `CLERK_WEBHOOK_SECRET` currently equals the `remarks-dev` webhook signing secret — there's no webhook endpoint configured in Clerk `remarks-prod` yet. Until one is added, `POST /webhooks/clerk` on the production API will reject any real live-mode events. Fix: in Clerk dashboard → remarks-prod → Webhooks, add `https://remarks-api.fly.dev/webhooks/clerk`, copy the new signing secret, and `flyctl secrets set CLERK_WEBHOOK_SECRET=whsec_… --app remarks-api`.
2. **Dashboard → API base URL is not set in Vercel.** The dashboard has no `NEXT_PUBLIC_API_URL` or equivalent. Preview + prod deploys currently can't call the API. Will be addressed when tRPC is wired up (spec tasks 1.11+).
3. **No dedicated preview-tier Clerk instance.** Vercel Preview shares `remarks-dev` with local dev. Fine for Phase 1; revisit if preview deploys start getting significant external testers.

## Audit commands

Read-only; safe to run any time:

```bash
# Fly secrets (names + digests only)
flyctl secrets list --app remarks-api --json

# Vercel env var shapes (run from apps/dashboard/)
for e in production preview development; do vercel env ls "$e"; done

# Neon branches (no credentials emitted)
neonctl branches list --project-id fragrant-mode-48800997

# R2 buckets
wrangler r2 bucket list
```
