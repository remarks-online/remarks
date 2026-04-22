# 0006. Vercel for the dashboard

Date: 2026-04-21
Status: Accepted

## Context

The dashboard is a Next.js 15 App Router application that relies on React Server Components, streaming, edge-friendly middleware (Clerk), and per-PR preview deployments. Running it anywhere other than Vercel means replicating a pile of Next.js-specific infrastructure (image optimization, ISR, edge middleware, preview environments) by hand. We want every PR to get a deploy URL we can click, and we want the production site to update on every merge to `main` without custom CI.

## Decision

Deploy **`apps/dashboard` to Vercel** on the team plan. Production domain is `app.remarks.online`, preview deployments attach to every PR automatically. The marketing site is served from the same Vercel project at `remarks.online` for now. Secrets are managed in Vercel's env-var UI per environment (dev, preview, production); never committed.

## Consequences

Zero-config deploys for Next.js, per-PR previews we can share with collaborators, and built-in analytics if we opt in. We are locked to Vercel's pricing and to Next.js App Router conventions — acceptable because the dashboard code is isolated (`apps/dashboard`) and the shared business logic lives in `packages/shared` and reaches the DB through the Fastify API, not directly. If we ever need to leave Vercel, the dashboard is a standard Next.js app that can be containerized and deployed anywhere.

## Alternatives considered

**Cloudflare Pages** — cheaper but Next.js App Router support lags behind Vercel's first-party hosting. **Self-host on Fly** — possible (Next.js runs in Docker), but we lose previews, ISR, and image optimization without rebuilding them. **Netlify** — similar story to Cloudflare; less friction for Next.js specifically than Vercel.
