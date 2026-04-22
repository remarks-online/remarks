# 0005. Fly.io for API hosting

Date: 2026-04-21
Status: Accepted

## Context

The Remarks API is a stateful long-running Fastify process that needs to hold DB pool connections, Redis connections, and eventually a WebSocket or SSE channel for realtime updates. Serverless functions (Vercel, Lambda) are a poor fit for this shape — every invocation reopens the DB pool, cold starts compound, and long-lived connections are impossible. We want to run the API as a persistent container in a region close to our users, with predictable billing, a simple deploy story, and the ability to scale horizontally later.

## Decision

Host **`apps/api` and (later) `apps/mcp` on Fly.io** as containerized long-running processes, defined by a `Dockerfile` and `fly.toml` per app. Start with one shared-CPU, 512 MB machine per region, with `auto_stop_machines = "suspend"` and `min_machines_running = 1` to keep cold starts off the first-user path. Deploy via `fly deploy` from GitHub Actions on merge to `main`.

## Consequences

We get real containers with real memory limits and real process lifecycles — no cold-start surprises, no 10-second function timeouts. $5–$20/month per service at launch, scaling linearly with traffic. We do have to think about container health, zero-downtime deploys, and multi-region rollouts eventually — all things Fly makes easy but that serverless would have abstracted away. If Fly's reliability becomes a concern, the Dockerfile-based deploy means we can move to Railway, Render, or a Kubernetes host with essentially zero code change.

## Alternatives considered

**Vercel Serverless Functions** for the API — rejected because of connection-pool thrash and the WebSocket/SSE requirement coming in Phase 2. **AWS Fargate / ECS** — too much IAM and VPC configuration for a one-person team. **Railway** — comparable DX to Fly but less control over VM sizing. **Render** — fine but pricier at our scale. **Self-host on a single VPS** — see ADR-0002; we don't want to operate infra for year 1.
