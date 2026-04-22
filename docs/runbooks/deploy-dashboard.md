# Runbook: Deploy the dashboard to Vercel (`app.remarks.online`)

One-time production setup for `apps/dashboard`. Covers Task 0.14 from `docs/plan/remarks-phase-0-1-spec.md`. Follow in order — step 4 depends on DNS records emitted by step 3, step 5 depends on the CNAME from step 4, and step 6 depends on Vercel verifying the custom domain.

Prerequisites (all from spec §8.1):

- Vercel team `remarks` exists.
- Cloudflare account owns the `remarks.online` zone.
- Clerk app `remarks-prod` exists.
- GitHub monorepo is pushed to `main`.

## 1. Create the Vercel project

In the `remarks` Vercel team → **Add New → Project** → import the `remarks` GitHub repo.

On the configuration screen:

- **Framework Preset**: Next.js (auto-detected).
- **Root Directory**: `apps/dashboard`. Check the box **"Include files outside of the Root Directory"** — the build needs `packages/shared` and the root `pnpm-lock.yaml`.
- **Build Command**, **Install Command**, **Output Directory**: leave blank (auto).
- **Node.js Version**: 22.x (matches `.nvmrc`).

Do **not** click *Deploy* yet — env vars go in first (step 2), otherwise the Zod validator in `src/env.ts` crashes the build.

## 2. Set Vercel environment variables

Project → **Settings → Environment Variables**. Set all three in **Production** scope, and again in **Preview** scope with `remarks-dev` test keys:

| Variable | Production value | Preview value |
|---|---|---|
| `CLERK_SECRET_KEY` | `sk_live_…` from `remarks-prod` | `sk_test_…` from `remarks-dev` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_…` from `remarks-prod` | `pk_test_…` from `remarks-dev` |

Do **not** set `NODE_ENV` — Vercel sets it automatically. Overriding it to `production` in Preview breaks dev-only Next features.

Trigger the first deploy (Deployments → the latest commit → *Redeploy*). It should finish Ready with a `*.vercel.app` URL. Open it to confirm the app renders (it will still talk to Clerk on Clerk's shared domain until step 6).

## 3. Configure the Clerk production domain

Clerk dashboard → **`remarks-prod` → Domains → Add domain** → `app.remarks.online`.

Clerk emits ~5 required DNS CNAMEs, all under `app.remarks.online`:

- `clerk.app.remarks.online` → `frontend-api.clerk.services` (or similar Clerk target)
- `accounts.app.remarks.online` → Clerk accounts host
- `clkmail.app.remarks.online` → Clerk mail host
- `clk._domainkey.app.remarks.online` → DKIM
- `clk2._domainkey.app.remarks.online` → DKIM

Copy the exact targets Clerk shows you — they're account-specific. Keep this tab open for step 6.

## 4. Configure Cloudflare DNS

Cloudflare → zone `remarks.online` → **DNS → Records**. Add:

| Type | Name | Target | Proxy status |
|---|---|---|---|
| CNAME | `app` | `cname.vercel-dns.com` | **DNS only (gray cloud)** |
| CNAME | `clerk.app` | (from Clerk) | **DNS only** |
| CNAME | `accounts.app` | (from Clerk) | **DNS only** |
| CNAME | `clkmail.app` | (from Clerk) | **DNS only** |
| CNAME | `clk._domainkey.app` | (from Clerk) | **DNS only** |
| CNAME | `clk2._domainkey.app` | (from Clerk) | **DNS only** |

**Every record must be unproxied (gray cloud).** Cloudflare's orange-cloud proxy terminates TLS and breaks both Vercel's Let's Encrypt cert issuance and Clerk's TLS provisioning. This is the most common failure mode — double-check before moving on.

Wait for propagation (usually <2 min on Cloudflare): `dig +short app.remarks.online` should return a `cname.vercel-dns.com` target.

## 5. Attach the domain in Vercel

Project → **Settings → Domains → Add** → `app.remarks.online`. Vercel re-checks the CNAME, then provisions a Let's Encrypt cert. Status moves to **Valid Configuration** within a minute or two.

Once valid, Vercel auto-assigns the Production alias. `https://app.remarks.online` now serves the latest Production deployment.

## 6. Verify and deploy Clerk production

Back in Clerk → `remarks-prod` → Domains → click **Verify** on each of the 5 CNAMEs (they should all flip to verified). Then click **Deploy** to promote the `remarks-prod` instance.

Clerk warns that production deploys are one-way — confirm only after the Vercel domain is Valid.

## 7. Verification (done-when)

Run the following checks; if any fail, stop and debug before marking 0.14 done.

```sh
# DNS
dig +short app.remarks.online                 # → cname.vercel-dns.com
dig +short clerk.app.remarks.online           # → Clerk frontend host

# TLS + HTTP
curl -sI https://app.remarks.online | head -1  # → HTTP/2 200
curl -sI https://app.remarks.online | grep -i strict-transport-security
```

In a browser at `https://app.remarks.online`:

- Homepage `/` renders.
- `/sign-in` renders the Clerk component; DevTools → Network shows requests to `https://clerk.app.remarks.online/*` (not `clerk.shared.lcl.dev`).
- `/app` unauthenticated → redirects to `/sign-in` (middleware at `apps/dashboard/src/middleware.ts`).
- Vercel → Deployments → latest shows Ready with `app.remarks.online` as a listed alias.

End-to-end sign-up (new user landing in the Neon `users` table) is **not** part of this task — that requires the Clerk webhook from Task 0.16.

## Recovery / common failures

- **Build fails with Zod env error** → env vars missing in the scope that was deployed. Check Production vs Preview scope.
- **`ERR_TLS_CERT_ALTNAME_INVALID` or "Invalid Configuration" in Vercel** → Cloudflare proxy is on. Set the `app` CNAME to DNS-only.
- **Clerk sign-in loads but auth calls 404** → `clerk.app.remarks.online` CNAME is missing or proxied. Re-check step 4.
- **`turbo-ignore` in `vercel.json` is skipping every build** → pass the workspace name explicitly: `npx turbo-ignore @remarks/dashboard`. To debug, set the env var `TURBO_IGNORE=1` locally and run the command against a given commit range.
