# 0018. Allow editing intent and severity after creation

Date: 2026-05-01
Status: Accepted

## Context

ADR-0016 § 5 stated: "No support for setting `intent` / `severity` via the user-auth UPDATE path (only via CREATE)." That decision was made before any human-facing UI for these classifiers existed; the assumption was that authors would pick correctly at capture time.

Once we wired the capture popover with intent + severity dropdowns and exposed badges in the dashboard / sidebar, the ergonomic gap became obvious: a captured annotation cannot be reclassified. The only way to fix a mistake is to delete and re-capture, which throws away the comment thread and any agent activity. Reviewers — not just authors — also need to triage by adjusting severity after a comment thread reveals the problem is bigger or smaller than first thought.

## Decision

`updateAnnotationRequestSchema` accepts optional, nullable `intent` and `severity`:

- `undefined` — no change.
- `null` — clear back to "uncategorized".
- An enum value — set to that classifier.

The `updateAnnotation` service emits two new event types alongside the existing `status_changed` / `comment_edited` rows so the activity feed records who reclassified what:

- `intent_changed` — payload `{ from, to }` (each `AnnotationIntent | null`).
- `severity_changed` — payload `{ from, to }` (each `AnnotationSeverity | null`).

Both event types extend `annotation_event_type` via migration 0008; new values append to the tail to match the `ALTER TYPE ADD VALUE` ordering convention used by 0001, 0003, and 0007.

The MCP write surface is not extended in this ADR. Agents already classify on create and do not have a documented need to re-classify; they may flip status via `update_task_status`. If an agent-side need surfaces, a follow-up ADR can add it without further migration.

## Consequences

**Wins.** Humans can correct mis-classifications without losing context. The dashboard detail sheet and extension edit popover gain editable Intent / Severity selects beside the existing Status select. Agent triage queries (`severity = 'blocking'`) reflect the latest human judgment, not whichever classification happened at capture.

**Costs.** Two new event-type enum values, one migration, and the `updateAnnotation` service grows from two changeable fields (`status`, `commentText`) to four (`status`, `commentText`, `intent`, `severity`). The service emits events per changed field, so reclassifying intent + severity in one PATCH writes two event rows — that's intentional; activity feeds should show each axis independently.

**Forward-compat.** The schema relaxation is one-way: rolling back ADR-0018 requires either gating the new fields off in the request schema (cheap) or refusing edits in the service (also cheap). No data loss. The new event types are append-only so older clients that don't recognize them still receive the event with its `type` string and can render a generic fallback.

## Alternatives considered

- **Keep ADR-0016 § 5; correct via delete + recapture.** Rejected. Loses comment threads and agent attribution; users would learn to ignore the classifiers because fixing them is destructive.
- **Allow editing but skip new event types — log to `comment_edited` instead.** Rejected. Conflates two different semantic changes; activity feeds become harder to scan; future reporting (e.g., "how often does severity change after capture?") loses a clean pivot.
- **Make intent + severity required on edit when present in the request.** Rejected. Would force PATCH callers that only want to change status to also re-send classifiers; breaks every existing dashboard call site.
