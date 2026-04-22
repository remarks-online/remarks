# 0002. Managed SaaS for year 1

Date: 2026-04-21
Status: Accepted

## Context

Remarks is a small-team product with one developer-shaped human writing the code and Claude Code assisting. The fastest path to a shippable product is to avoid operating infrastructure that isn't differentiated — auth servers, Postgres clusters, object storage, job queues, email relays, log aggregators — and spend time on the things that *are* differentiated: the annotation experience, the agent contract (MCP), and the dashboard UX. Each managed service we adopt is a line item on the monthly bill, but it is also an operator, an on-call rotation, and a security audit we don't need to run ourselves.

## Decision

For year 1, **every piece of commodity infrastructure is a managed SaaS** on a free or low-cost tier: Clerk (auth), Neon (Postgres), Fly.io (API hosting), Vercel (dashboard hosting), Cloudflare R2 (object storage), Upstash (Redis), Inngest (background jobs), Resend (email), PostHog (analytics), Sentry (error tracking). The only things we run code on are the application layers themselves. A new hosting provider or managed service cannot be added without an ADR (CLAUDE.md §1.10).

## Consequences

Monthly cost scales with usage, not with team size, and stays well under $100/month at launch. Each vendor is a dependency; a vendor outage or pricing change propagates into our product. We accept that tradeoff for year 1 and will revisit before scaling past small-team usage: at some point self-hosting Postgres or moving off Clerk may make sense, and the `packages/db` + `packages/shared` boundaries are designed to make those migrations a rewrite of one layer, not the whole stack.

## Alternatives considered

**Self-host everything on a single VPS** (Postgres + Redis + API + screenshots). Cheaper in raw dollars but expensive in hours; a single team member cannot credibly operate a production Postgres while also shipping features. **A single PaaS like Render or Railway for everything.** Rejected because the specialists (Clerk for auth, Neon for Postgres branching, Vercel for Next.js) each do their one job materially better than a generalist, and the lock-in to any one PaaS is higher than the lock-in to ten well-scoped SaaS APIs with documented exports.
