# 0019. SSE event stream for annotations (G9)

Date: 2026-05-01
Status: Accepted

## Context

`docs/analysis/2026-04-30-agentation-vs-remarks.md` G9 calls for live event streams over SSE — `/projects/:projectId/events` and `/users/:userId/events`, each in a Clerk-auth and an internal-MCP variant — so the dashboard can show a live activity feed (D1) and any "agent watch loop" (G10) has something to subscribe to. Without the stream, every consumer polls.

The analysis document explicitly leaves the storage layer open: "Use Postgres LISTEN/NOTIFY or Redis pub/sub from the existing `annotationEvents` insert path."

Constraints:

- Single Fly machine today (`apps/api/fly.toml`: `[[vm]] cpu_kind="shared", cpus=1, memory_mb=512`). Fan-out must stay cheap.
- The API uses postgres-js with a TCP pool — supports `LISTEN`/`NOTIFY` natively. Upstash Redis is wired only into `apps/mcp`; `apps/api` does not depend on it.
- CLAUDE.md §1.10 requires justification for any new runtime dependency.
- Annotations are already inserted inside `db.transaction` at four sites (annotation.service.ts createAnnotation/updateAnnotation, mcp.service.ts agentUpdateAnnotationStatus/agentAddAnnotationComment), each followed by a fire-and-forget post-commit side effect (PostHog `captureAnalytics`).

## Decision

1. **Use Postgres `LISTEN`/`NOTIFY`, not Redis.** Adding Redis to `apps/api` would cost a CLAUDE.md §1.10 dep justification with no operational gain at single-machine scale. NOTIFY is already broadcast cluster-wide, so the design also works the moment we scale horizontally — every Fly machine `LISTEN`s on its own connection and naturally fans the message to its locally-connected SSE clients.

2. **One single-channel publisher** (`annotation_events`) carrying the full envelope as a JSON payload. Per-project / per-user routing happens in memory inside the broker, not in Postgres. Bytes-per-event are well under Postgres's 8 KB NOTIFY ceiling.

3. **Hand-rolled SSE response** (`apps/api/src/lib/sse.ts`). No new dependency: `@fastify/sse-v2` would only add header sugar.

4. **Dedicated single-connection LISTEN client.** `createListenClient` (in `packages/db/src/client.ts`) opens a `postgres()` instance separate from the application pool. Calling `sql.listen` on the shared application pool was observed to interfere with concurrent operations on it during integration-test setup — a dedicated client isolates the listener and makes its lifecycle explicit. The shared pool still handles `pg_notify` writes (one-off SELECT, no connection reservation).

5. **Lazy listener attach.** `bus.start()` runs on the first subscribe rather than at boot. Tests that don't open SSE never open the LISTEN socket; the integration harness can build/tear-down servers in a tight loop without any listener-related flakes.

6. **Resume via `Last-Event-ID`** (RFC-style). Event ids are encoded as `<createdAtIso>:<eventUuid>` so a string compare matches the (createdAt, id) keyset order used elsewhere in the API. On reconnect:
   - First check the in-process ring buffer (256 events; ~30 s at 8 events/s) for a hit on the resume id. If hit, replay the matching slice.
   - Otherwise read from `annotationEvents` joined to `annotations`, capped at 200 rows. If the cap is hit, emit `event: replay_truncated` so the client can decide to do a fresh REST list.

7. **Connection cap and rotation.** `MAX_SSE_CONNECTIONS` (default 200) bounds RAM/FD usage on the 512 MB VM by rejecting new subscribers with 503 *before* SSE headers are written. `MAX_SSE_CONNECTION_MS` (default 5 min) rotates a single connection by emitting `event: rotate` and closing — clients reconnect with `Last-Event-ID` for an automatic resume. Rotation also refreshes the per-user project-membership snapshot without an explicit invalidation channel.

8. **Post-commit publish.** Each of the four annotation-event insertion sites returns the freshly-inserted row's `id` and `createdAt` from the transaction, then calls `bus.publish()` after commit — the same shape as the existing `captureAnalytics` post-commit pattern. A NOTIFY failure is logged but never thrown.

## Consequences

- One additional Postgres connection per machine (the LISTEN socket). Fly's default `max_connections` and Neon's pooling both have headroom for that.
- SSE clients see eventual consistency (NOTIFY round-trip ≈ 1–10 ms on a healthy DB). Acceptable for a UX that already polls today.
- The dedicated LISTEN client must end on shutdown — wired into `bus.close()` and called from the plugin's `onClose` hook.
- Multi-machine deploys "just work": every machine's broker `LISTEN`s, every machine's NOTIFY broadcasts, each machine fans out to its own subscribers. No cross-machine sticky routing required.
- Missed-event window: after a producer writes the row but before NOTIFY processes it, an SSE client could disconnect and miss the event. The replay path (in-buffer or DB-backed) catches it on reconnect provided the client reconnects within the buffer/DB window. Documented as not-a-concern at current event volume.

## Alternatives considered

- **Upstash Redis pub/sub.** Mature, but adds a new runtime dep and a second managed service the API depends on. No upside at our current scale.
- **`@fastify/sse-v2`.** A small package that wraps the same writes we already do by hand. Avoided to keep the dep surface tight.
- **Eager LISTEN at boot.** Cleaner mental model but caused test-harness interference (rapid build/tear-down of Fastify servers in series). Lazy attach via subscribe is one extra branch and removes the entire failure mode.
- **Shared application pool for both LISTEN and NOTIFY.** Simpler infra but exposed the test interference. The dedicated LISTEN client is one extra connection per machine — acceptable.
- **Per-project channel names.** Would push routing to Postgres (`LISTEN annotation_project_<uuid>`) and trade in-process Map fan-out for one Postgres connection per project. Rejected: O(projects) connections is worse at scale than O(machines) connections.
