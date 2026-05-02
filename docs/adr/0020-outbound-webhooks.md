# 0020. Outbound webhooks (G11)

Date: 2026-05-02
Status: Accepted

## Context

`docs/analysis/2026-04-30-agentation-vs-remarks.md` G11 calls for project-level outbound webhooks: customers integrating Remarks into Linear / Jira / Slack today have no path. Without webhooks, every external integration is a custom build. Agentation ships first-class webhooks; we are catching up with a deliberately narrower v1.

Constraints:

- Inngest is already wired for background work (ADR-0013); SSE ships post-commit fan-out (ADR-0019); there is no separate worker layer to invent.
- The SSE event bus already enumerates the four `annotationEvents`-insertion chokepoints (`createAnnotation`, `updateAnnotation`, `agentUpdateAnnotationStatus`, `agentAddAnnotationComment`). Outbound webhook fan-out hooks the same sites.
- CLAUDE.md §1.10 requires justification for any new runtime dependency. Node `crypto` covers signing.
- The dashboard is tRPC-only for mutations (ADR-0010).

## Decision

1. **Two new tables in `packages/db`**: `project_webhooks` (id, projectId, url, secret, events text[], active, createdAt, updatedAt) and `project_webhook_deliveries` (id, webhookId, annotationId, eventType, attempt, requestBodySize, responseStatus, responseBodySnippet, errorMessage, succeeded, createdAt, deliveredAt). Both cascade on project / annotation delete so cleanup follows existing data flows.

2. **Curated v1 event taxonomy.** Four webhook event types: `annotation.created`, `annotation.status_changed`, `annotation.comment_added`, `annotation.resolved`. Mapped 1:1 from existing `annotation_event_type_enum` values plus a synthetic `annotation.resolved` derived whenever a status transition lands on `done`. Internal-only types (intent_changed, severity_changed, agent_acknowledged, comment_edited) are deliberately excluded; extending later is additive.

3. **Inngest delivery, not in-process.** A new `remarks/webhook.deliver` event published per (webhook × annotation event) pair; `createWebhookDeliverFunction(db)` consumes it. Each invocation inserts one `project_webhook_deliveries` row regardless of outcome and throws on non-2xx so Inngest retries. Default `retries: 4` policy gives ~exponential backoff; the last attempt's row carries the failure as the implicit dead-letter record.

4. **Stripe-style HMAC signing.** Header: `Remarks-Signature: t=<unix_seconds>,v1=<hex_hmac_sha256>`. HMAC over `${t}.${rawBody}`. Receivers reject signatures with `t` outside their replay window (we recommend ±5 minutes in the runbook). Companion headers: `Remarks-Event` (event type) and `Remarks-Delivery-Id` (the `project_webhook_deliveries.id`, useful for support).

5. **Plaintext secrets, displayed once.** 32 random bytes hex, generated server-side on create / rotate. Returned in the `create` and `rotateSecret` responses; never returned by `list` / read paths. Mirrors GitHub's webhook UX. Encrypted-at-rest is deferred — it would apply to OAuth client secrets and service tokens too, and is best handled as one KMS layer when the platform grows that capability.

6. **Fan-out service is best-effort.** `apps/api/src/services/webhook-fanout.service.ts` queries active webhooks subscribed to the mapped event type and `inngest.send`s one event per webhook. Catches `inngest.send` failures and logs (mirrors `publishR2Cleanup`); never throws back into the request path. Personal annotations (projectId=null) skip fan-out — webhooks are project-scoped only in v1.

7. **tRPC for CRUD.** `webhooks` router with admin-only `list`, `create`, `update`, `rotateSecret`, `delete`, `listDeliveries`, `test`. The `test` procedure publishes a synthetic Inngest event so the customer can verify end-to-end without waiting for real activity. No public REST surface in v1.

## Consequences

- **Delivery durability matches Inngest.** Retries, observability, and replay all reuse the existing job runner; no bespoke worker to operate.
- **Secret loss requires a rotation flow.** A customer who didn't capture the secret on create must `rotateSecret` and update the receiver. Not a regression — there is no current alternative because there were no webhooks.
- **Per-attempt audit rows.** Reading the deliveries table shows each retry separately rather than collapsing into one "final outcome" row. Easier to debug, slightly chattier.
- **No org-scoped webhooks.** A future "send all annotation events from any project I admin" use case requires another design pass. Out of v1.
- **Fan-out adds one query per event.** Read is small (active webhooks for one project) and indexed (`project_webhooks_project_active_idx`). Negligible at current scale; revisit if a hot project produces sustained high-frequency events.

## Alternatives considered

- **In-process delivery** — rejected: blocks the API request path, dies on deploy, has no retry semantics, and competes with the tRPC mutation budget. Inngest is already in the toolbelt for exactly this shape.
- **Encrypted secrets at rest** — deferred: would have to ship alongside a KMS choice that applies to other secret-bearing tables (OAuth clients), and the v1 trade-off (treat the row like an API token) is industry-standard for webhook signing.
- **Per-event Postgres LISTEN/NOTIFY broker** — rejected: NOTIFY is already used for SSE and fits in-process subscribers; durable delivery to external HTTP receivers belongs on Inngest's retry / step infrastructure.
- **Public REST CRUD surface** — deferred: dashboard is tRPC-only; adding REST is additive when a customer asks for curl-driven config. No customer pull yet.
