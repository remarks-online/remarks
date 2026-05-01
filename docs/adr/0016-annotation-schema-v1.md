# 0016. Annotation schema v1 — intent, severity, and the acknowledged status

Date: 2026-04-30
Status: Accepted

## Context

The annotation row described by `packages/db/src/schema/annotations.ts` is the contract every Remarks surface (extension, dashboard, MCP) reads and writes. Through Phase 2 it carried only `status` (`to_do | doing | done | rejected`) and `targetType` (`element | rectangle | route`) as classifiers. In practice that's too thin:

- Agents can't distinguish "fix this", "I'm asking a question", "approve this", and "consider changing this" without parsing the comment text — every annotation looks the same on the wire.
- Humans can't triage by priority. A "blocking" copy fix and a "suggestion" sits in the same to-do bucket.
- The agent collaboration loop has only two in-flight states, `to_do` and `doing`. Hands-free agent loops want a separate "I've read this task and signalled receipt, but haven't started work" state — agentation.com names this `acknowledged` and uses it as the linchpin of their `watch_annotations` MCP tool.

The April 2026 gap analysis in `/Users/joshuaziggas/.claude/plans/perform-a-gap-analysis-logical-sphinx.md` ("Agentation vs. Remarks") flagged this as the single highest-leverage schema gap. Specs G1, G2, G3, X1.

## Decision

The annotation row gains three nullable triage fields and one new status value. The full v1 contract:

**Annotation columns**

| Column          | Postgres type           | Nullable | Notes                                                  |
| --------------- | ----------------------- | -------- | ------------------------------------------------------ |
| `intent`        | `annotation_intent`     | yes      | `fix \| change \| question \| approve` (G1)            |
| `severity`      | `annotation_severity`   | yes      | `blocking \| important \| suggestion` (G2)             |
| `status`        | `annotation_status`     | no       | extended with `acknowledged` (G3); default `to_do`     |

Both classifier columns default to NULL — a missing value is rendered as "uncategorized" by the dashboard. Existing rows backfill as NULL; no data migration is required.

**Annotation event types**

`annotation_event_type` gains `agent_acknowledged`. When `agentUpdateAnnotationStatus` writes `acknowledged`, it emits this event type instead of the generic `agent_updated_status` so the dashboard can render a compact "agent acknowledged" pill rather than a full status-transition row. All other agent transitions stay on `agent_updated_status`.

**Single source of truth**

Wire-format Zod schemas live in `packages/shared/src/schemas/annotation.ts`:

- `annotationIntentSchema`, `annotationSeveritySchema`, `annotationStatusSchema` are the canonical enum schemas.
- `createAnnotationRequestSchema` accepts optional `intent` and `severity`.
- `annotationResponseSchema` carries them as nullable fields.
- `OPEN_ANNOTATION_STATUSES = ["to_do", "doing", "acknowledged"]` is the canonical "in-flight" set, consumed by the project-context open-task counter.

The MCP wire-format package (`packages/mcp-schema`) re-exports `TASK_STATUSES = ANNOTATION_STATUSES` and extends `AGENT_UPDATE_STATUSES` to include `acknowledged`. Wire-shape changes are limited to: a new value appearing in the `status` enum, two new optional fields on `get_task` / list-task responses (only after a follow-up plumbs them through the MCP wire), and `agent_acknowledged` events appearing in event histories.

## Consequences

**Wins.** Agents can filter open work by `severity = 'blocking'`. Triage views in the dashboard get an obvious sort key. The `acknowledged` state separates "I've seen this" from "I'm working on this", which is the missing primitive for any future `watch_annotations` MCP tool (G10) and for hands-free agent loops generally.

**Costs.** A schema migration with two `CREATE TYPE` and two `ALTER TYPE ADD VALUE` statements (`packages/db/drizzle/0007_intent_severity_acknowledged.sql`). The `ALTER TYPE ADD VALUE` form requires that the new value not be used in the same transaction it's added — Drizzle's migrator handles this via `--> statement-breakpoint` separators, the same way 0001 and 0003 added previous values.

**Forward-compat.** `OPEN_ANNOTATION_STATUSES` exists so future open-status additions (e.g., `blocked`) can be made in one place rather than chasing every `IN (…)` predicate. The two classifier columns are nullable to keep the upgrade graceful — clients written before this ADR keep working, they just don't see the new fields.

**What this ADR does *not* do.** No support for setting `intent` / `severity` via the user-auth UPDATE path (only via CREATE). No "kind" enum (G5) and no layout-mode classifier — both deferred until the layout/wireframe direction is real. No new MCP tools (G6 `acknowledge`, G8 `get_pending`) — those are follow-ups; this ADR only puts the schema primitives in place so they can be built without further migrations.

## Alternatives considered

- **JSON sidecar.** Drop `intent`/`severity` into the existing `annotations.dom_context` jsonb instead of new columns. Cheaper schema-wise; gives up indexability and fails the §1.4 "schema lives in the type system" rule. Rejected.
- **Single `priority` integer (0–4).** Smaller surface, but loses the `blocking` / `important` / `suggestion` semantics that humans actually use when triaging. Rejected.
- **Don't ship `acknowledged` until the whole hands-free loop is built.** Defers the schema, which means the eventual G9/G10/G11 work needs an extra migration on top. Rejected — schema primitives are cheap to ship eagerly and expensive to back-fit.
- **Make `intent` and `severity` required on create.** Forces every caller (extension, dashboard quick-capture) to pick values they often don't have an opinion about, which leads to junk classifications. Rejected; nullable wins.
