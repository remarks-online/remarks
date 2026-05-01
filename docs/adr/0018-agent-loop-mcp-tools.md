# 0018. Agent-loop MCP tools — acknowledge, dismiss, get_pending, get_all_pending

Date: 2026-05-01
Status: Accepted

## Context

ADR-0016 added the schema primitives for tighter agent-collaboration UX (intent, severity, the `acknowledged` status, the `agent_acknowledged` event type). What it deliberately did *not* do was expose those primitives as named verbs on the MCP surface. Agents can already drive the new acknowledged transition via `remarks_update_task_status`, but the discovery and ergonomics gap remains:

- **No verb for "I see this; I haven't started"** — agents reach for `update_task_status` with a magic enum value. Agentation's MCP server names this `acknowledge` and pairs it with an optional comment, which is the natural shape (an agent acknowledging a task is the moment it's most likely to ask a clarifying question).
- **No required-reason gate on dismissal.** The current status route accepts an optional `note`. An agent can call `update_task_status` with `status: rejected` and no context, leaving humans to guess why the task was killed. Agentation requires a reason on dismiss; reviewers want the same.
- **No "what should I work on" view.** Agents have to call `list_tasks` and filter for `to_do`/`acknowledged` client-side. Triage is the most common opening move of an agent session — it deserves a dedicated tool.
- **No cross-scope view.** When an agent works across multiple projects (or personal + project annotations), they have to fan out across `list_tasks` calls per scope.

The 2026-04-30 gap analysis (`docs/analysis/2026-04-30-agentation-vs-remarks.md`) groups these as G6, G7, G8a, G8b, plus the API-side dismiss-reason validation as G4.

## Decision

Four new MCP tools, one API-side validation refinement, and one new internal HTTP route — all read/wrap existing storage; no schema migration.

### MCP tools

All defined in `packages/mcp-schema/src/tools.ts` and handled in `apps/mcp/src/tools/`. Idempotency, scope checks, and attribution follow the same pattern as the existing tools (ADR-0011, ADR-0015).

| Tool                       | Purpose                                                        | Wraps                                                              |
| -------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `remarks_acknowledge`      | Set status to `acknowledged`; optionally append a comment.     | `updateAnnotationStatus` + (optional) `addAnnotationComment`.       |
| `remarks_dismiss`          | Set status to `rejected` with a required reason ≥ 10 chars.    | `updateAnnotationStatus` (passes reason as `note`).                 |
| `remarks_get_pending`      | Project-scoped triage — `to_do` + `acknowledged` only.         | `fetchListAnnotations` with the pending status filter.              |
| `remarks_get_all_pending`  | Cross-scope triage — caller's personal + every member project. | `fetchListAllAnnotations` (new) → `listAnnotationsForUser` "all".    |

Schema highlights:

- **`acknowledge`** input: `task_id`, optional `comment` (1–MAX_COMMENT_LENGTH chars), optional `kind` (`clarification_request | progress_update | completion_note`), optional `idempotency_key`. A schema-level refinement rejects `kind` without `comment` (kind is meaningless without comment text). When `comment` is set without `kind`, the comment is recorded as `clarification_request` — that's the dominant use case (an agent acknowledging a task is most likely asking a question before committing). Output adds `comment_event_id: string | null` so the agent can correlate the comment row without a follow-up read.
- **`dismiss`** input: `task_id`, `reason` (uses the shared `rejectionReasonSchema` from `packages/shared` — trimmed, 10–500 chars), optional `idempotency_key`. Output: status literal `rejected`. Reason rides through `updateAnnotationStatus` to land on the resulting `agent_updated_status` event payload as `payload.reason`.
- **`get_pending`** / **`get_all_pending`**: pagination (`limit`, `cursor`) and output shape match `remarks_list_tasks`. Pending = `["to_do", "acknowledged"]`. `doing` is excluded — that's *active* work, not pending.

### API alignment: G4 already shipped on main

While this work was in progress, G4 (require a reason on rejection) shipped on `main` via a dedicated `reason` field — `statusUpdateBodySchema` adds `reason: rejectionReasonSchema.optional()` with refines that make it required when `status === "rejected"` and reject it on any other transition. The `note` field stays as optional commentary for non-rejection transitions. `remarks_dismiss` consumes the same shared `rejectionReasonSchema`, so the MCP-tool layer and the API layer enforce identical bounds; agents that bypass `remarks_dismiss` and call `remarks_update_task_status` with `status: "rejected"` get the same validation error if the reason is missing or too short.

### API change: cross-scope listing route

`GET /internal/mcp/users/:clerkUserId/all-annotations?statuses=&limit=&cursor=`. Backs `remarks_get_all_pending`. Reuses `listAnnotationsForUser`'s existing `scope: "all"` mode (personal annotations the caller authored + every annotation in projects where the caller has a `project_members` row, regardless of org). No service change required — the scope already exists for the user-facing REST endpoint; this route exposes it on the MCP-internal surface so the MCP server can read it via `x-internal-auth` instead of needing a Clerk session.

### Dashboard surfacing

`apps/dashboard/src/components/annotations/event-row.tsx` already shipped its G4 surface on main: `status_changed` and `agent_updated_status` events both flow through a `formatStatusChange` helper that surfaces `payload.reason` as a "Reason:" detail line whenever the transition lands on `rejected`. The "changed status" vs "updated status" verbs distinguish human vs agent without a separate badge.

This ADR adds explicit cases for the two remaining agent event types that were still falling through to the generic "{actor} · {event.type}" fallback:

- `agent_acknowledged` renders as "{actor} acknowledged this".
- `agent_commented` renders the comment body and surfaces the optional `kind` as an inline label.

A full threaded conversation UI is D4 in the gap analysis and explicitly out of scope.

## Consequences

**Discovery and triage improve.** Agents see four named verbs on the MCP manifest that match the natural agent-loop vocabulary, instead of relying on enum values inside a generic mutator.

**Reasons stick.** Every dismissal now has a reviewable explanation, and reviewers see it inline in the dashboard event log. Aligns with the audit posture in ADR-0015.

**No new schema, no migration.** All four tools and the API change ride on top of the existing tables and the `acknowledged` status / `agent_acknowledged` event type from ADR-0016.

**Idempotency surface grows by two.** `acknowledge` and `dismiss` honor `idempotency_key` like the other mutators. The 24h Redis cache contract is unchanged.

**Tool registry grows.** The MCP tool list goes from 8 to 12. Per Phase 2 §3.1 ("tool names are stable; new capability is a new tool, not a rename"), adding tools is the supported way to evolve the surface — none of the existing tools change.

**Out of scope (intentionally):** the threaded reply UX (D4), the `watch_annotations` SSE-backed tool (G10/D1), and a richer dashboard "pending" view (D3). Those depend on the SSE infrastructure (G9) which is a separate spec.

## Alternatives considered

**Don't add new tools — let agents keep calling `update_task_status` with the magic value.** Rejected: discoverability is the entire point. An agent reading the MCP manifest should see "acknowledge" and "dismiss" as first-class actions; otherwise the schema-level distinction from ADR-0016 leaks back into prose-only documentation.

**Enforce dismissal reason only in the MCP tool, not the API route.** Rejected: an agent (or a misbehaving custom client) can call `remarks_update_task_status` with `status: rejected` and no note. The MCP-tool-only enforcement leaves the bypass open. Belt-and-braces with the API refinement closes it without any user-facing cost.

**Add a `/me/pending` endpoint specifically scoped to "pending" status.** Rejected: status filter belongs on the existing list endpoints (and the existing MCP-internal personal/org endpoints already support `?statuses=`). Adding a status-specific route would duplicate the cursor encoding and pagination machinery for no gain. The new `/all-annotations` route is justified because the *scope* (personal + cross-org) wasn't previously exposed on the MCP surface — not because the *filter* required a new endpoint.

**Make `get_pending` accept a multi-project list.** Rejected for now: each agent session usually targets a single project context. If batch queries become a real use case, `get_all_pending` (cross-scope) covers it; we can add a project-array variant later without breaking the simple-case API.

**Use a tiered output format like agentation's Compact/Standard/Detailed/Forensic.** Out of scope; the gap analysis lists this as G18 (markdown export) and explicitly defers it. One good output is enough until users ask for tiers.
