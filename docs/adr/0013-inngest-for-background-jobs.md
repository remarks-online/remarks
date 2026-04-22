# 0013. Inngest for background jobs

Date: 2026-04-21
Status: Accepted

## Context

Remarks has several operations that should not run inline on the request path: generating thumbnails from uploaded screenshots, running OCR or element-context extraction, sending notification emails, syncing Clerk webhook events, and eventually fanning out MCP events to subscribers. We need a job system that gives us durability (a crashed worker doesn't lose a job), retries with backoff, scheduled/delayed jobs, and an audit trail we can inspect when something goes wrong. Running our own queue (BullMQ + Redis + a worker process on Fly) is the traditional answer but adds an operational burden we don't want to carry.

## Decision

Use **Inngest** as the durable job platform. Jobs are defined as functions in the API codebase (and later MCP), triggered by events (`remarks/screenshot.uploaded`, `remarks/annotation.created`, etc.) or on a schedule. Inngest handles delivery, retries, step-function-style durability, and provides a UI to inspect job history. The API publishes events to Inngest via their SDK; the API *is* the Inngest worker — Inngest calls our endpoint when it's time to run a step, so there's no separate worker process to host.

## Consequences

No Redis queue to operate, no worker process to keep alive, and a UI for inspecting job state comes free. Durable steps mean a job can survive a Fly deploy mid-run without duplicating side effects. We're dependent on Inngest's availability for async work — acceptable for email, thumbnails, and webhooks; we would not route anything that must complete in milliseconds through it. Pricing is generous at our scale.

## Alternatives considered

**BullMQ + Redis + a Fly worker** — more control, more operations. **Temporal** — extremely powerful but heavyweight for our needs. **Cloudflare Queues** — fine for simple queueing; lacks the step-function durability and the job-inspection UI. **Database-backed queue (pg-boss, graphile-worker)** — simple and we already have Postgres, but we'd build our own retry/backoff/observability instead of using Inngest's. Reasonable fallback if we ever move off Inngest.
