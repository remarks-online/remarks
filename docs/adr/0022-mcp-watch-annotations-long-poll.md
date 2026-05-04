# 0022. MCP `watch_annotations` long-poll over SSE

Date: 2026-05-03
Status: Accepted

## Context

ADR-0019 (`0019-sse-event-stream.md`) shipped the SSE producer (G9): `/projects/:projectId/events` and the user-scoped twin, both for browser clients and via the `/internal/mcp/...` pair for the MCP server. D1 in the agentation gap analysis (`docs/analysis/2026-04-30-agentation-vs-remarks.md`) consumed the SSE feed in the dashboard.

What's still missing is the agent surface: today an agent that wants to know "what new tasks landed?" has to poll `remarks_list_tasks`. The reference design is [vibe-annotations' watch mode](https://www.vibe-annotations.com/docs/workflows/watch-mode), where the agent is told "Start watching" and calls a `watch_annotations` tool in a loop. We want to ship the equivalent — and decisively beat their feature set, since the user goal here is "Remarks should have a better feature set than the alternative."

The hard constraint shaping the design: Remarks' MCP server uses `@modelcontextprotocol/sdk@1.29.0` with `StreamableHTTPServerTransport` and stateless per-request `Server` instances. Tools are strict request/response — the SDK does not expose `notifications/progress` or any streaming `CallToolResult` shape. A tool call cannot yield multiple results over time.

## Decision

Ship `remarks_watch_annotations` as a **long-poll** tool. Each call holds the connection open until the first matching event arrives or `wait_seconds` (default 30, max 55) elapses, returns a batch with a `next_cursor`, and the agent loops.

**Server-side**: a new `/internal/mcp/projects/:projectId/watch` and `/internal/mcp/users/:clerkUserId/watch` pair (mode = personal / all / org). Both reuse `fastify.annotationEventBus` (LISTEN/NOTIFY broker from ADR-0019) via a new `collectAnnotationEvents` helper in `apps/api/src/services/event-stream.service.ts`. The helper subscribes, drains the in-memory ring buffer + DB replay for events newer than the cursor, then either returns immediately (replay had matches), waits for the first event then coalesces a `batch_window_ms` burst, or hits the wait deadline. Annotations are hydrated via `getAnnotationById` so each event in the response carries its current annotation snapshot inline — no follow-up `remarks_get_task` round-trip needed. Filters (`intent`, `severity`, `status`, `event_types`, `branch`) are applied server-side; `event_types` at the bus sink, the rest after hydration.

**MCP-side**: `apps/mcp/src/tools/watch-annotations.ts` is a thin wrapper that authorizes the requested scope (project member / org member / personal-self), forwards filters to the API, and projects the camelCase API payload into the snake_case wire shape. No new runtime deps in the MCP — `fetch` plus an `AbortController` with a `wait_seconds + 10s` margin is enough.

**`auto_acknowledge` side effect**: when set, after the watch endpoint has collected events and **unsubscribed** from the bus, it flips any to_do annotation in the batch to `acknowledged` via the existing `agentUpdateAnnotationStatus` service. The resulting `agent_acknowledged` events are published to the bus but our subscription is already gone, so they don't feed back into the same response. They surface on the agent's next call; the agent typically filters them out of its loop via `event_types`.

### Improvements over vibe-annotations (the explicit goal)

| Capability | vibe | Remarks G10 |
| --- | --- | --- |
| Sequential delivery | ✅ | ✅ |
| Server-side filters (intent / severity / status / event_types / branch) | ❌ | ✅ |
| Resume cursor (Last-Event-ID-style) | ❌ | ✅ |
| Batch delivery for clustered events | ❌ | ✅ (configurable burst window) |
| Inline annotation snapshot | ❌ | ✅ (no follow-up `get_task`) |
| Optional `auto_acknowledge` on delivery | ❌ | ✅ |
| Personal / org / project / cross-scope | single project only | ✅ |
| Caller-controlled idle exit | hard 5min server cap | ✅ `idle: true` per call; agent stops when it wants |
| Auth-bounded (RBAC) | n/a | ✅ project membership + personal scope check |

## Consequences

- **Connection cap.** Long-poll subscribers count against the existing `MAX_SSE_CONNECTIONS` cap (default 200). With `wait_seconds=30` that's ~6.7 sustained watchers/sec per node — plenty for current scale, but the cap is shared with the dashboard SSE feed and any future browser stream consumers. If we run out we'll bump the cap before splitting watch onto a separate budget.
- **Auto-ack visibility on the next call.** Auto-ack events (`agent_acknowledged` rows) are persisted and broadcast normally; they show up on the agent's next call. Documented in the tool description; agents who don't want their own acks filter via `event_types`.
- **Stale snapshots within a batch.** When two events on the same annotation appear in one response, both render the annotation's *current* state, not the state at each event's `created_at`. The event payload still carries the from→to delta, which is what an agent uses to react to a change. This is correct for most use cases; documented.
- **Replay truncation.** If `since` is older than the in-memory ring + DB replay window (200 rows), `replay_truncated: true` is set. Agents should reconcile via `remarks_get_pending` rather than trust the partial replay.
- **No abort signal plumbed through to the API yet.** The Fastify request lifecycle doesn't expose a clean `AbortSignal` to handlers. The `wait_seconds` ≤ 55 cap bounds the resource cost; if a client disconnects mid-wait, the bus subscriber sits until the timer fires. Acceptable for v1.

## Alternatives considered

1. **Consume SSE from the MCP server.** Open an SSE connection to G9's existing endpoint inside the tool handler, buffer events, return a batch. Rejected: adds `@microsoft/fetch-event-source` (or hand-rolls the parser) on the MCP, doubles the network hop for what is essentially a single-batch RPC, and pushes filter logic to the consumer. The new long-poll endpoint is cleaner and keeps the dashboard's SSE consumer as the only SSE client.
2. **Wait for SDK streaming.** When `@modelcontextprotocol/sdk` exposes `notifications/progress` or yieldable tool results in a stable release, a future ADR can swap the body of this tool to push events as they arrive. The schema is forward-compatible — the response shape (events array + cursor) maps cleanly onto a streaming yield.
3. **Pure DB poll.** Skip the bus entirely, just query `annotation_events` with a `since` cursor. Rejected: forces every agent loop into a polling cadence (latency floor ≈ poll interval) and doesn't reuse the LISTEN/NOTIFY infrastructure we already pay for. The long-poll endpoint gives near-real-time delivery in the common case.
4. **Push via webhooks instead.** ADR-0020 covers webhooks (G11) — push from the API to a customer URL. Different problem: webhooks are server→customer, watch is agent→server-pull. They co-exist; an agent doesn't run a public HTTP listener.
