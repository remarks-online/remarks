# 0021. Annotation grouping (G17 multi-element batch select)

Date: 2026-05-03
Status: Accepted

## Context

`docs/analysis/2026-04-30-agentation-vs-remarks.md` G17 calls for a way to
file one piece of feedback that targets several DOM elements at once
("make these three buttons match") instead of three separate annotations.
Until now the picker treats every click as a single-element pick that
opens its own draft popover.

The same gap analysis sketches two storage shapes — N annotations sharing
a `groupId`, or one annotation carrying an array of selectors — and asks
for the decision to be revisited after G16 (text-mode) lands. G16 is not
yet implemented; this ADR scopes V1 to **element-only batches** so we
can ship without locking the data model on a guess about how text spans
will look.

The original spec also proposed Shift+click as the modifier. Shift is
unavailable in practice: the picker entry hotkey is `⌘⇧E`, so Shift is
in flight when the picker opens, and a Shift+click would frequently fire
on the user's first click. Several modifier-key alternatives have known
platform issues — Alt+click on Mac downloads the link target before our
`preventDefault` can run, some Linux WMs swallow Alt-drag for window
move, and ChromeOS uses Alt+click as a right-click emulator on certain
configurations.

## Decision

1. **Storage**: nullable `group_id uuid` column on `annotations` plus a
   non-unique index. N annotations in one batch share the same UUID;
   single-pick rows leave it null. Migration `0010_annotation_group_id.sql`.
2. **Generation**: client-side. The extension mints one UUID per "Post"
   click and threads it through every outbox record in the batch. The
   server stores whatever the client supplies, with no batch endpoint —
   the existing `POST /annotations` and `POST /projects/:projectId/annotations`
   already accept the full body, plus one new optional field.
3. **Primary entry: a sidebar toggle pill**. `SidebarPickerHint` adds a
   "Multi-select" pill while element-mode is active. When the toggle is
   on, every click in the session appends to `pendingSelections` instead
   of finishing the pick. Explicit "Done"/Enter commits; Esc clears the
   batch and turns off the toggle but keeps the picker session alive.
4. **Power-user shortcut: Alt/Option+click** — same append behavior as
   the toggle, per click. Documented with the platform caveats above so
   users who hit Linux WM conflicts know to fall back to the toggle.
5. **Per-element screenshot, index-keyed dispatch**. Each capture in a
   batch carries its own data URL (the user may scroll between picks).
   `requestScreenshot` learns an `onResult` callback so the controller
   can write into `pendingSelections[index]` via a new
   `setScreenshotForPending(index, screenshot)` action.
6. **Popover stack**: when `pendingSelections.length > 1` the popover
   replaces `DomContextHeader` with a list of N selectors and per-row
   remove buttons. One comment + one intent/severity for the whole
   batch.
7. **Atomicity tradeoff: per-record outbox, not a single multi-capture
   record**. Each pending capture becomes its own `OutboxRecord` with
   the shared `groupId` on the payload. Pre-validation runs in the
   popover (`createAnnotationRequestSchema.safeParse` per capture)
   before any record is enqueued, so deterministic 400s never produce
   a partial group. The remaining failure modes are retryable
   (network, 5xx, 401-refresh) and the existing outbox retries until
   they succeed.
8. **Read shape**:
   - `AnnotationResponse` adds nullable `groupId` and a denormalized
     `groupSize` (positive int) computed via one `COUNT(*) … GROUP BY
     group_id` per page.
   - `mcpTaskSummarySchema` and `getTaskOutputSchema` add `group_id`
     and `group_size` snake-cased.
   - `mcp.service.ts` `related_tasks` query gets a third OR clause
     `eq(annotations.group_id, row.group_id)` (gated on `row.group_id
     !== null`) so agents see siblings via `get_task` even when the
     batch members live on different URLs/selectors.
9. **No new event type**. Each annotation still emits its own `created`
   event. The dashboard live feed (D1) **debounces toast notifications
   on `groupId` collision in a 5-second window** so a 3-element batch
   surfaces as one toast instead of three. Server-side, the SSE
   `payload` for `created` carries `{ groupId }` when the row is
   grouped — Postgres NOTIFY's 8 KB ceiling has plenty of headroom.
10. **Webhook payload unchanged**. Receivers can already look up the
    annotation via the API to learn its `groupId`. Adding it inline
    would require either denormalizing into the `annotation_events`
    payload at insert time or a per-event DB hit in the deliverer —
    neither pulls its weight for a v1 read-only consumer hint.

## Consequences

- A 3-element multi-select with no screenshot adds three rows to
  `annotations`, three to `annotation_events` (`created`), three to the
  outbox, and (when present) three R2 PUTs. We do **not** dedupe screenshots
  to a single asset in V1; the cost at expected sizes is acceptable.
- The new `groupSize` on `AnnotationResponse` adds one cheap query per
  list page (`COUNT(*) … GROUP BY group_id` with the new index). Single
  `getAnnotationById` calls also pay one query when `row.groupId` is set.
- Card UI surfaces "· N in group" only when `groupSize > 1`; the
  single-pick path is unchanged.
- Agents that consume `related_tasks` automatically pick up sibling
  awareness. No new MCP tool is needed.
- Discoverability rests on the always-visible toggle pill plus a one-time
  `seenMultiSelectHint` flag in `sidebarStore` for any future first-run
  treatment. The flag flips the first time element-mode opens after this
  PR ships.

## Alternatives considered

- **Array selectors on a single annotation row**. Cleaner for one comment
  → many anchors, but commits the data model before G16 (text-mode)
  arrives. Text-mode may want array offsets within one annotation, which
  is a different shape than element-batches; deferring lets that decision
  inform a future revisit.
- **Server-side batch endpoint with one transaction**. Stronger atomicity
  story but forks the create path entirely (new schema, new route, new
  service). Per-record + client-side pre-validation gets near-zero
  partial-group risk without the rewrite.
- **Modifier-key only (no toggle)**. Loses to platform issues with
  Alt+click on Mac (download link), Linux (WM move), ChromeOS (right-click
  emulator). The toggle is a visible, discoverable fallback.
- **Single outbox record carrying `captures: Capture[]`**. Stronger
  group consistency on transient failures, but requires migrating the
  IndexedDB shape, the drain loop, and the banner UI. If telemetry shows
  non-retryable in-flight failures producing partial groups, we revisit
  by moving to this shape.
- **New `group_created` event type**. Cleaner consumer story but forces
  another `annotation_event_type_enum` migration on top of `0010`. The
  client-side toast debounce is the smaller fix.

## Future work

- G16 (text-selection mode) may introduce array-offset shape for a
  single text span. When it lands we revisit whether multi-element
  batches stay groupId-based or migrate to array selectors on one row.
- If non-retryable in-flight failures show up in telemetry, restructure
  the outbox to "single record, captures: Capture[]" so partial drains
  can't ship.
- Group-aware filters / "Open all in group" affordance / bulk status by
  group — defer until customer pull justifies the surface area.
