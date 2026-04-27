# Remarks: Phase 2 Implementation Spec

This document is the executable spec for Phase 2: the MCP server and the Remarks Skill. It is written to be handed to Claude Code session-by-session, same pattern as the Phase 0/1 spec.

**Scope of this doc:**
- The hosted MCP server at `mcp.remarks.dev` and its tool schemas
- The Remarks Skill bundled with the MCP server
- Authentication for agent-to-server calls
- The install experience (how a user connects their agent to Remarks)
- Retroactive changes to the Phase 1 data model needed to support Phase 2 cleanly

**Out of scope for this doc:**
- GitHub integration (Phase 3). Phase 2's `open_pr` tool is a stub until Phase 3.
- Billing (Phase 3)
- Figma / policy / design-system governance (year 2)
- Any changes to the browser extension other than the "Connect agent" install flow in the sidebar

**Prerequisite:** Phase 1 is complete per its exit criteria. Users can create orgs, projects, and annotations; the extension works; markdown export works.

---

## Table of contents

1. [Product goals for Phase 2](#1-product-goals-for-phase-2)
2. [The shape of the agent integration](#2-the-shape-of-the-agent-integration)
3. [MCP tool schemas](#3-mcp-tool-schemas)
4. [The Remarks Skill](#4-the-remarks-skill)
5. [Authentication and authorization](#5-authentication-and-authorization)
6. [Install experience](#6-install-experience)
7. [Data model amendments](#7-data-model-amendments)
8. [Transport and infrastructure](#8-transport-and-infrastructure)
9. [Observability specific to agent traffic](#9-observability-specific-to-agent-traffic)
10. [Phase 2 task breakdown](#11-phase-2-task-breakdown)
11. [Exit criteria for Phase 2](#12-exit-criteria-for-phase-2)

---

## 1. Product goals for Phase 2

Phase 2 delivers three things and nothing else:

1. **A hosted MCP server** that any MCP-compatible agent can connect to. Tools are stable, well-documented, versioned.
2. **A Remarks Skill** distributed as part of the MCP server's initialization, teaching connected agents the methodology of processing Remarks tasks well. One Skill, distributed to every agent, rendered however each agent natively handles skills/rules/instructions.
3. **An install flow in the Remarks dashboard** that gets a user from "I want to use my AI agent with this" to "it's working" in under 3 minutes, without editing config files by hand.

The success test: a new Remarks user, having never seen the product before, can sign up, install the extension, create an annotation, connect their agent, and have the agent close that annotation — all in under 10 minutes, with zero markdown files touched.

Explicit non-goals for Phase 2:
- Slash commands
- Per-agent config files
- Local MCP server / stdio transport (hosted only)

---

## 2. The shape of the agent integration

### 2.1 Three layers, all model-agnostic

```
┌──────────────────────────────────────────────────────────────┐
│  Agent (Claude Code, Cursor, Windsurf, Codex, Copilot, ...)  │
└──────────────────────────────────────────────────────────────┘
                │                              │
      reads Skill at                  calls tools at
      connection time                 runtime
                │                              │
                ▼                              ▼
┌──────────────────────────────────────────────────────────────┐
│                  mcp.remarks.dev                             │
│                                                              │
│   Skill distribution      MCP tool surface                   │
│   (SKILL.md + assets)     (list_tasks, get_task, etc.)       │
└──────────────────────────────────────────────────────────────┘
                │                              │
                └──────────────┬───────────────┘
                               ▼
                    ┌─────────────────────┐
                    │   Remarks API       │
                    │   (Postgres + R2)   │
                    └─────────────────────┘
```

The Skill and the tools both live in the MCP server's surface. They're both agent-agnostic. The agent decides how to render each.

### 2.2 What "model-agnostic" means in practice

We do not ship agent-specific config files, rule files, or slash commands. We do ship one thing per agent that genuinely needs it: **an install snippet** — the bit of JSON or CLI command that tells that agent where the MCP server lives and how to authenticate. The Remarks dashboard generates this snippet on demand for any agent the user picks from a dropdown; the dashboard owns the catalog of supported agents, but the server knows nothing about which agent is calling it.

The MCP server treats every agent identically. It identifies them by the `User-Agent` header and the `client_info` field in the MCP initialization handshake (which is a standard MCP mechanic), but that's only for logging and analytics — never for behavior branching. If we ever need per-agent behavior, we write an ADR first.

### 2.3 What the agent gets from connecting

When an MCP client connects to `mcp.remarks.dev`, two things happen in the initialization handshake:

1. The client receives the **tool manifest** — the list of available tools with their input/output schemas, descriptions, and usage hints.
2. The client receives a **resource**: the Remarks Skill, served as a resource under `remarks://skill/current`. Clients that support resources (all modern ones do) can fetch and use it; clients that don't can still use the tools effectively because tool descriptions embed the minimum necessary guidance.

Agents that understand Skills natively (Claude Code, Cursor via Rules, Windsurf via Cascade) display the Skill content in the user's context automatically. Agents that don't understand Skills specifically still get the tool descriptions, which reference the Skill inline where critical.

---

## 3. MCP tool schemas

This section defines the complete tool surface. Every tool is specified with its Zod schema (authoritative) and a human description. These schemas live in `packages/mcp-schema/src/tools.ts` and are consumed by both the MCP server and the tool-description generator.

### 3.1 Design principles

- **Stable names.** Once a tool name ships, it's permanent. New capability = new tool, not a rename.
- **Versioned via the server, not the tool.** The MCP server exposes a version in the initialization response; breaking changes bump the server version (`v1` → `v2`). Individual tools don't carry versions.
- **Minimal required inputs, rich optional ones.** Easy to call correctly; powerful if you want to.
- **Rich, structured responses.** Never return just an ID where the agent will immediately need to call `get_task` again. If the agent will obviously need field X, include X.
- **No ambient state.** Every call is independent; no "currently active task" concept on the server. Agents track their own state.
- **Namespace prefix `remarks_`.** Every tool name starts with `remarks_` to avoid collisions with other MCP servers the user might have connected.
- **Idempotency.** Any tool that mutates accepts an optional `idempotency_key` (UUID). The server caches (key → response) for 24 hours in Redis. Duplicate calls return the cached response without re-executing.

### 3.2 The tool surface

Eight tools, total. Grouped by purpose.

#### Discovery

**`remarks_list_tasks`** — List tasks in a project, optionally filtered.

```ts
input: {
  project_id: string (uuid),
  branch?: string,                               // exact match; omit for all branches
  status?: ("to_do" | "doing" | "done" | "rejected")[],  // default: ["to_do", "doing"]
  limit?: number (1–100, default 20),
  cursor?: string,                               // opaque pagination token
}

output: {
  tasks: Array<TaskSummary>,
  next_cursor: string | null,
}

TaskSummary: {
  id: string (uuid),
  status: "to_do" | "doing" | "done" | "rejected",
  branch: string,
  url: string,
  target_type: "element" | "rectangle" | "route",
  comment_preview: string,                       // first 120 chars
  author: { name: string, email: string },
  created_at: string (ISO),
  has_screenshot: boolean,
}
```

Description: *"Returns Remarks tasks for the given project. Tasks are visual feedback items that a human has left on a running web application. Default filter returns open (to_do) and in-progress (doing) tasks. Call `remarks_get_task` to get full context for a specific task."*

#### Working with a single task

**`remarks_get_task`** — Full context for one task, including DOM metadata and screenshot URL.

```ts
input: {
  task_id: string (uuid),
}

output: {
  id: string (uuid),
  status: "to_do" | "doing" | "done" | "rejected",
  branch: string,
  url: string,
  comment: string,                               // full text
  target: {
    type: "element" | "rectangle" | "route",
    selector?: string,                           // CSS selector (element mode)
    coords?: { x, y, width, height },            // doc-relative px (rectangle mode)
  },
  viewport: { width, height, dpr },
  dom_context: {
    tag_name?: string,
    classes?: string[],
    text_content?: string,                       // first 500 chars
    computed_styles?: Record<string, string>,
    ancestors?: Array<{ tag_name: string, classes?: string[] }>,
  } | null,
  framework_hint: string | null,                 // "react" | "vue" | "svelte" | etc.
  screenshot_url: string | null,                 // presigned, 1h expiry; fetch if multimodal
  author: { name, email },
  related_tasks: Array<{ id, comment_preview, status }>,  // other tasks on same URL/element
  created_at: string (ISO),
  updated_at: string (ISO),
}
```

Description: *"Returns full context for a single Remarks task. The `target.selector` is the primary targeting signal — it's the CSS selector of the element the user clicked. The `screenshot_url` is supplementary visual context; fetch it only if your model is multimodal. The `related_tasks` array lists other tasks on the same URL or targeting the same element; check them for dependencies before making changes (e.g., if one task says 'make blue' and another says 'add shadow', implement blue first)."*

**`remarks_update_task_status`** — Change a task's status.

```ts
input: {
  task_id: string (uuid),
  status: "doing" | "done" | "rejected",
  note?: string,                                 // optional explanation, attached to event
  idempotency_key?: string (uuid),
}

output: {
  id: string (uuid),
  status: "doing" | "done" | "rejected",
  updated_at: string (ISO),
}
```

Description: *"Updates a task's status. Use `doing` when starting work, `done` when the code change is committed, `rejected` if the task cannot or should not be done. Include a `note` when rejecting to explain why. Always follow the sequence: to_do → doing → done. Skipping doing (to_do → done directly) is allowed but discouraged — it loses useful signal about when work was in progress."*

**`remarks_add_task_comment`** — Agent posts a comment on a task (asking for clarification, explaining a decision, etc.).

```ts
input: {
  task_id: string (uuid),
  comment: string (1–5000 chars),
  kind?: "clarification_request" | "progress_update" | "completion_note",
  idempotency_key?: string (uuid),
}

output: {
  event_id: string (uuid),
  created_at: string (ISO),
}
```

Description: *"Adds a comment to a task. Use this to ask the human for clarification, explain a decision that wasn't obvious, or note completion details. The comment appears in the Remarks dashboard as an agent-authored event. Prefer doing the work over asking questions, but when a task is genuinely ambiguous, ask."*

#### Batching

**`remarks_batch_update_status`** — Update multiple tasks' statuses in one call. Primarily for performance when the agent is processing many tasks.

```ts
input: {
  updates: Array<{
    task_id: string (uuid),
    status: "doing" | "done" | "rejected",
    note?: string,
  }> (1–50 items),
  idempotency_key?: string (uuid),
}

output: {
  results: Array<{
    task_id: string,
    success: boolean,
    error?: string,
  }>,
}
```

Description: *"Updates multiple task statuses in a single call. Use this when processing a batch of related tasks to reduce round-trips. Partial failures are reported per-task; the call itself does not fail if individual updates fail."*

#### Context gathering

**`remarks_get_project_context`** — Project metadata that's useful during a work session: active branches, recent activity, project settings.

```ts
input: {
  project_id: string (uuid),
}

output: {
  project: {
    id, name, slug,
    primary_branch: string,
    git_repo_url: string | null,                 // null in Phase 2 until GitHub integration
  },
  active_branches: Array<{
    name: string,
    open_task_count: number,
    last_activity: string (ISO),
  }>,
  design_tokens: null,                           // Phase 4+; reserved field returned as null
}
```

Description: *"Returns project metadata and a list of branches with open tasks. Call this at the start of a work session to understand what's available. The `design_tokens` field will be populated in a future phase; currently null."*

#### PR integration (stub in Phase 2, real in Phase 3)

**`remarks_open_pr`** — Signal that a set of tasks has been completed and a PR should be linked.

```ts
input: {
  project_id: string (uuid),
  task_ids: string[] (uuid[], 1–50),
  branch: string,
  title?: string,
  description?: string,
  idempotency_key?: string (uuid),
}

output: {
  // In Phase 2: returns a "pending" status because we can't open PRs yet
  status: "pending_github_integration" | "opened",
  pr_url: string | null,
  message: string,                               // human-readable status
}
```

Description: *"Signals that a set of Remarks tasks has been completed on a branch. In Phase 2, this records the intent and returns `pending_github_integration`; actual PR creation ships in Phase 3 once the GitHub App is installed. Call this when all task code changes are committed locally."*

#### Health

**`remarks_whoami`** — Who am I, what can I access? Useful for agents verifying their connection.

```ts
input: {}

output: {
  project: { id, name, slug },                   // the project this token is scoped to
  token_name: string,
  token_scopes: string[],
  server_version: string,                        // e.g., "v1.0.3"
  skill_version: string,                         // e.g., "2026-04-22"
}
```

Description: *"Returns information about the current Remarks connection. Use this to verify connectivity and see which project this token accesses."*

### 3.3 Errors

Every tool can return these errors (wrapped in MCP's `isError: true` response shape):

| Code | When |
|---|---|
| `UNAUTHORIZED` | Token missing, malformed, or revoked |
| `FORBIDDEN` | Token valid but doesn't grant access to requested resource |
| `NOT_FOUND` | Task/project doesn't exist or is outside token's scope |
| `VALIDATION_ERROR` | Input fails schema validation; `details` carries Zod issues |
| `CONFLICT` | Idempotency-key replay with different payload, or status transition invalid |
| `RATE_LIMIT` | Throttled; `retry_after_seconds` in the error payload |
| `INTERNAL` | Server bug; request ID is returned for support |

Agents should retry on `RATE_LIMIT` respecting the `retry_after_seconds`, and on `INTERNAL` up to 2 times with exponential backoff. All other errors are terminal.

### 3.4 What's deliberately not a tool

- **No `remarks_create_task`.** Tasks are created by humans via the extension. If an agent wants to add context to an existing task, that's `remarks_add_task_comment`. Letting agents create tasks inverts the product's intent.
- **No `remarks_delete_task`.** Deletion is a human decision from the dashboard. Agents reject or close.
- **No `remarks_assign`.** Assignment is a team-UI concern, not an agent concern. Agents operate on whatever's in scope of their token.
- **No design-system / token tools in Phase 2.** `remarks_get_design_tokens` is reserved but not implemented; comes in year 2.

---

## 4. The Remarks Skill

The Skill is the methodology layer. It tells agents *how* to use the tools well — what order to call them in, how to batch, how to interpret ambiguity, what quality looks like.

### 4.1 Where it lives

The Skill is a markdown file with YAML frontmatter, stored in the Remarks repo at `apps/mcp/skills/remarks/SKILL.md`. It's embedded into the deployed MCP server at build time (via `import.meta.glob` or equivalent) and served as an MCP resource at `remarks://skill/current`.

Versioning: the Skill carries a `version` field in its frontmatter (date-stamped: `2026-04-22`). The server returns the current version in the `remarks_whoami` response so agents can detect when the Skill has updated.

### 4.2 Content outline

The Skill is ~400 lines total. Sections:

1. **Purpose** (2 paragraphs): what Remarks tasks are, who creates them, what good output looks like.
2. **Processing modes** (1 page):
   - **Step**: one task at a time, await human confirmation before next. Safest.
   - **Batch**: group related tasks (same URL, same component, same theme) and implement together.
   - **Autonomous**: process all pending tasks without stopping. Default unsafe; require user to opt in via the agent's own mechanism (e.g., "yolo" prompt or equivalent).
   - Agent picks mode based on user's instructions; default is step.
3. **The processing loop** (diagram + 1 page): list_tasks → get_task → implement → update_status. With explicit guidance on when to batch status updates via `remarks_batch_update_status`.
4. **Interpreting tasks** (2 pages):
   - The `comment` field is primary intent; read it carefully.
   - The `target.selector` is the editing entry point.
   - `dom_context.computed_styles` is the before-state.
   - The screenshot is supplementary; use for ambiguity resolution, not as primary signal.
   - `related_tasks` describes dependencies. Example: two tasks on the same button → resolve in creation order unless the comments imply a different ordering.
5. **Code quality expectations** (1 page):
   - Prefer design tokens over raw values when the codebase uses them. Detect this by reading the stylesheet the clicked element's class points to.
   - Prefer existing components over new ones; if the task says "make a button," check if there's already a `<Button>` before adding an `<button>`.
   - Accessibility is non-negotiable: don't remove ARIA labels, don't drop focus states, don't reduce contrast below 4.5:1 unless the task explicitly says so.
   - Modern CSS over legacy patterns: logical properties, `gap`, `aspect-ratio`, CSS custom properties.
6. **Status lifecycle** (½ page):
   - Always `to_do → doing → done`. Batch the transitions into fewer tool calls when possible.
   - Reject rather than force when a task is wrong, unsafe, or outside scope.
   - Add a `completion_note` comment for non-trivial changes explaining what was done.
7. **Error handling** (½ page):
   - Retry `RATE_LIMIT` with backoff.
   - Retry `INTERNAL` twice.
   - Stop and ask the human on `VALIDATION_ERROR` or `FORBIDDEN`.
8. **What not to do** (1 page):
   - Don't create tasks; humans create tasks.
   - Don't delete tasks; humans delete tasks.
   - Don't mark a task `done` until the code is committed.
   - Don't batch unrelated tasks together.
   - Don't modify the DOM at runtime; edit source code.
   - Don't invent design tokens; use existing ones or ask.

### 4.3 Skill frontmatter

```yaml
---
name: Remarks
description: Process visual feedback tasks from the Remarks browser extension into working code changes.
version: 2026-04-22
triggers:
  - "remarks task"
  - "process my remarks"
  - "review remarks"
  - "remarks inbox"
---
```

The `triggers` list is agent-agnostic hint text; agents that support skill triggering (like Claude Code's skill system) use it to surface the Skill when relevant. Agents without skill-triggering ignore it.

### 4.4 What the Skill replaces

The existing [Drawbridge](https://github.com/breschio/drawbridge/blob/main/chrome-extension/rules-templates/drawbridge-workflow.md) `drawbridge-workflow.md` is the prior art. That file is ~800 lines because it's trying to do two jobs: teach the AI methodology *and* encode a fragile file-based contract (batched reads of `moat-tasks-detail.json`, status updates as simultaneous writes to two files, etc.). Half of it is workarounds for the lack of a proper API.

The Remarks Skill drops all the file-format workarounds. It's ~400 lines of pure methodology. The MCP tools handle the contract; the Skill handles the wisdom.

---

## 5. Authentication and authorization

> Superseded as of 2026-04-26 by [ADR-0015](../adr/0015-mcp-oauth-via-clerk.md). The original §5.1–§5.5 specced a project-scoped bearer-token model (`rmk_live_…` minted in the dashboard, pasted into the agent's MCP config). It is replaced wholesale by OAuth 2.1 with Clerk as the authorization server. The sections below describe the model that ships.

### 5.1 OAuth model

The MCP server is an **OAuth 2.1 resource server**; Clerk is the **authorization server**. Tokens are Clerk-issued JWTs validated against Clerk's JWKS. There are no Remarks-issued opaque tokens.

- **Discovery.** The MCP server publishes RFC 9728 Protected Resource Metadata at `/.well-known/oauth-protected-resource/mcp`, listing the Clerk tenant's issuer URL in `authorization_servers`. Clerk publishes RFC 8414 Authorization Server Metadata at `/.well-known/oauth-authorization-server` (advertising `code_challenge_methods_supported: ["S256"]`).
- **Client registration.** RFC 7591 Dynamic Client Registration is enabled on the Clerk OAuth applications page. Pre-registration is the fallback for enterprise customers. Client ID Metadata Documents (the MCP spec's preferred path, [SEP-991]) are not enabled in Phase 2 because Clerk doesn't yet support them; tracked as a follow-up.
- **PKCE.** S256, mandatory (Clerk enforces).
- **Resource indicator (RFC 8707).** Clients pass `resource=https://mcp.remarks.dev/mcp`. The MCP server validates the JWT's audience claim contains this canonical URI.

### 5.2 Token scope and permission model

**One access token covers every project the authenticated Clerk user is a member of.** No per-project consent step. Authorization happens per tool call:

- Tools that take `project_id` (everything except `whoami`): the handler resolves the target project and calls `assertProjectAccess(clerkUserId, projectId)` against the `project_members` table (cached in Redis 300s).
- Tools that take `task_id` (`get_task`, `update_task_status`, `add_task_comment`, `batch_update_status`): the handler resolves the task → its project, then runs the same membership check.
- Non-member → 403 with `WWW-Authenticate: Bearer error="insufficient_scope"`.

OAuth scopes (defined per OAuth-app on Clerk):
- `tasks:read` — list/get tools.
- `tasks:write` — update status, comments, batch updates.
- `project:read` — `remarks_get_project_context`.
- `whoami` requires only authentication.

### 5.3 Transport auth

The MCP server expects `Authorization: Bearer <jwt>` on every request. Missing/invalid → 401 with:

```
WWW-Authenticate: Bearer resource_metadata="https://mcp.remarks.dev/.well-known/oauth-protected-resource/mcp",
                         scope="tasks:read tasks:write project:read"
```

MCP-compatible clients (Claude Code, Cursor, Windsurf, etc.) parse this header and execute the OAuth 2.1 flow without further configuration.

### 5.4 How auth maps to the API

The MCP server calls the main Remarks API (`api.remarks.dev`) for all data operations; it doesn't talk to Postgres directly. The auth flow:

1. Agent sends request with `Authorization: Bearer <jwt>` (Clerk-issued).
2. MCP server validates the JWT locally (signature against Clerk's JWKS, `iss`, `aud` includes `https://mcp.remarks.dev/mcp`, `exp`, `nbf`). On failure: 401.
3. MCP server attaches `{ clerkUserId, scopes, oauthClientName }` to the request.
4. Tool handler resolves the target `project_id` (from input or via task→project lookup) and calls the API: `GET /internal/users/:clerkUserId/projects/:projectId` (cached 300s in Redis at `cache:mcp:projects:{clerkUserId}`). 200 → member; 404 → 403 from the tool.
5. On success, the handler calls the API for the actual data, attributing agent-authored events to the (Clerk user, OAuth client name) pair. The OAuth client name is captured at DCR time (e.g., "Claude Code") and stored on the event row.

The internal API trusts the MCP server because both run in the same Fly VPC with a shared service token; no different from the bearer-token model. What's new is that the source of project authorization is `project_members` (single source of truth, also used by the dashboard) rather than a separate `project_api_tokens` table.

### 5.5 Rate limiting for agent traffic

Agents make more requests than humans and need different limits:

| Bucket | Limit | Window |
|---|---|---|
| `mcp_read` (list_tasks, get_task, whoami, get_project_context) | 600 | 60s per Clerk user |
| `mcp_write` (update_status, add_task_comment, batch_update_status, open_pr) | 200 | 60s per Clerk user |

Shared Redis instance with the Phase 1 rate limiter, key prefix `ratelimit:mcp:{bucket}:{clerkUserId}`. The bucket key changed from `tokenHash` to `clerkUserId` because grants are per-user, not per-token.

---

## 6. Install experience

> Rewritten 2026-04-26 to match [ADR-0015](../adr/0015-mcp-oauth-via-clerk.md). The original §6 instructed the user to mint a token in the dashboard and paste it into their agent's config. The OAuth flow eliminates the paste step.

### 6.1 The dashboard flow

In the Remarks dashboard, under a project, there's a "Connect Agent" page that **shows the user how to install the MCP server in their agent of choice**. No tokens are minted or shown; the page is a guide.

For each preset agent the page renders:

1. **The one-line install command**, ready to copy:
   - Claude Code: `claude mcp add --transport http remarks https://mcp.remarks.dev/mcp`
   - Cursor / Windsurf / Codex CLI: equivalent CLI command or settings-pane deep link.
2. **A manual-config JSON snippet** as a fallback for clients that don't have an `add`-style command. The snippet has no `Authorization` header — the agent obtains its token via OAuth on the first request.
3. **A short "What happens next"** explanation: "On first use, your agent will open a browser to log into Remarks. The first tool call may be `remarks_whoami` — once that succeeds, you're connected."
4. **A "Verify Connection" button** that polls the membership cache (same Redis-based last-seen mechanism we already use). On success: ✓ Connected. On timeout (2 minutes): a troubleshooting block.

The canonical page lives at `/app/connect-agent` (header nav), since grants are per-user and one OAuth login covers every project the user is a member of plus their personal annotations. Per-project settings link to the same page.

### 6.2 Snippet examples (for the dashboard to render)

The dashboard generates these strings from per-agent templates in `apps/dashboard/src/lib/agent-presets.ts`. None of them are hardcoded on the agent side.

**Claude Code — preferred path (CLI):**
```
claude mcp add --transport http remarks https://mcp.remarks.dev/mcp
```

**Claude Code — manual config (`.claude/mcp.json` or `~/.claude/mcp.json`):**
```json
{
  "mcpServers": {
    "remarks": {
      "type": "http",
      "url": "https://mcp.remarks.dev/mcp"
    }
  }
}
```

**Cursor (`.cursor/mcp.json`):**
```json
{
  "mcpServers": {
    "remarks": {
      "url": "https://mcp.remarks.dev/mcp"
    }
  }
}
```

**Windsurf (`~/.codeium/windsurf/mcp_config.json`):**
```json
{
  "mcpServers": {
    "remarks": {
      "serverUrl": "https://mcp.remarks.dev/mcp"
    }
  }
}
```

The snippets are intentionally minimal — no `Authorization` header. On the agent's first MCP request, the server returns 401 with the `WWW-Authenticate` challenge, the agent runs OAuth 2.1 + DCR + PKCE against Clerk, the user logs in via the browser, and the agent caches the resulting access token + refresh token locally.

### 6.3 The "Verify Connection" step

After the user pastes/runs the install snippet and restarts their agent, they click "Verify Connection." The dashboard polls an internal endpoint that reads the Redis last-seen key for the user's grants. On success: ✓ Connected. On timeout (2 minutes): troubleshooting guide with common issues — Clerk's DCR toggle off, browser blocking the redirect, agent not restarted, etc.

### 6.4 Rotation and revocation

**Account Settings → Connected Apps** shows a table of OAuth grants for the current user: client name (from DCR — "Claude Code", "Cursor", etc.), first authorized, last used (from Redis), scopes granted. Each row has a "Revoke" action that calls Clerk's grant-revocation API. Revocation propagates within ≤ 5 minutes (the membership cache TTL); no plaintext rotation flow because there is no plaintext to rotate.

For users who need access removed from a specific project rather than for a specific agent, Project Settings → Members → Remove still works — that drops the row from `project_members`, the Redis cache invalidates within 5 minutes, and the agent gets 403 on the next call to that project.

---

## 7. Data model amendments

Phase 1 captures most of what's needed. Phase 2 adds three things:

### 7.1 Project API tokens table (REMOVED)

Originally specced as `project_api_tokens` (hashed bearer tokens with prefix/last4 display). [ADR-0015](../adr/0015-mcp-oauth-via-clerk.md) removed this table; the migration `0004_drop_project_api_tokens.sql` drops it. Authorization derives from `project_members` for the authenticated Clerk user. Headless/CI scenarios that need a long-lived secret will be addressed by a future Clerk service-account flow.

### 7.2 Annotation events: two new event types

```ts
// Add to annotation_event_type_enum
"agent_updated_status",   // emitted when an agent (not a human) calls update_status
"agent_commented",        // emitted when an agent calls add_task_comment
```

These let the dashboard distinguish agent-authored events from human-authored ones and render them differently (robot icon, slight visual treatment, etc.).

### 7.3 `annotation_events` actor columns (revised)

Originally specced as `actor_id` (user) + `actor_token_id` (token) + `actor_type`. [ADR-0015](../adr/0015-mcp-oauth-via-clerk.md) replaces `actor_token_id` with `actor_oauth_client_id text` (the OAuth-app name from DCR — "Claude Code", "Cursor"). Agent-authored events still set `actor_id` (the Clerk user the agent is acting on behalf of) — that's how attribution is preserved.

```ts
// annotation-events schema
actorType: pgEnum("event_actor_type", ["user", "agent", "system"]),
actorOauthClientId: text("actor_oauth_client_id"), // null unless actor_type = 'agent'
```

When `actor_type = 'agent'`, both `actor_id` (Clerk user) and `actor_oauth_client_id` (OAuth client name) are set. When `actor_type = 'user'`, only `actor_id` is set. When `actor_type = 'system'`, both are null. The check constraint enforces this.

### 7.4 No other schema changes needed

The Phase 1 `annotations` table already has everything the tools need: `target_selector`, `target_coords`, `viewport`, `dom_context`, `framework_hint`, `comment_text`, `url`, branch relationship, author, status. Nothing to add.

This is the outcome I was hoping for — specifying the MCP tools now doesn't force a schema rewrite.

---

## 8. Transport and infrastructure

### 8.1 MCP transport: streamable HTTP

The MCP server uses the **streamable HTTP transport** (MCP spec 2025-06-18). This is a single HTTP endpoint that handles bidirectional communication via a mix of regular HTTP responses and optional Server-Sent Events for streaming. Advantages over the older stdio or SSE-only transports:

- Works through corporate proxies and firewalls.
- Standard HTTP/1.1 or HTTP/2 — no special transport for CDNs or load balancers.
- Clean auth via `Authorization` header.
- Each request is independent; no long-lived socket state.

### 8.2 Deployment

The MCP server is `apps/mcp`, deployed to Fly.io as a separate service from `apps/api`. Both run in the same Fly org and same region, with private networking between them.

```toml
# apps/mcp/fly.toml
app = "remarks-mcp"
primary_region = "iad"

[env]
  NODE_ENV = "production"
  PORT = "3001"
  API_INTERNAL_URL = "http://remarks-api.internal:3000"       # Fly private networking

[http_service]
  internal_port = 3001
  force_https = true
  auto_stop_machines = "suspend"
  auto_start_machines = true
  min_machines_running = 1

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 512
```

One machine, $5/month, scales horizontally automatically when traffic justifies.

### 8.3 Implementation sketch

Using the official TypeScript MCP SDK:

```ts
// apps/mcp/src/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { tools } from "./tools";
import { skillResource } from "./resources/skill";
import { authenticate } from "./auth";

export function createMcpServer() {
  const server = new Server(
    { name: "remarks", version: "1.0.0" },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  // Register tools
  server.setRequestHandler(/* ListToolsRequestSchema */, async () => ({
    tools: tools.map((t) => t.manifest),
  }));

  server.setRequestHandler(/* CallToolRequestSchema */, async (req, extra) => {
    const auth = await authenticate(extra.headers);
    const tool = tools.find((t) => t.manifest.name === req.params.name);
    if (!tool) throw new Error("Unknown tool");
    return tool.handler(req.params.arguments, auth);
  });

  // Register Skill as a resource
  server.setRequestHandler(/* ListResourcesRequestSchema */, async () => ({
    resources: [skillResource.manifest],
  }));

  server.setRequestHandler(/* ReadResourceRequestSchema */, async (req) => {
    if (req.params.uri === skillResource.manifest.uri) {
      return { contents: [{ uri: req.params.uri, text: skillResource.content, mimeType: "text/markdown" }] };
    }
    throw new Error("Unknown resource");
  });

  return server;
}
```

```ts
// apps/mcp/src/tools/list-tasks.ts
import { z } from "zod";
import { callApi } from "../lib/api-client";
import type { AuthContext, McpTool } from "../types";

const inputSchema = z.object({
  project_id: z.string().uuid(),
  branch: z.string().optional(),
  status: z.array(z.enum(["to_do", "doing", "done", "rejected"])).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const listTasksTool: McpTool = {
  manifest: {
    name: "remarks_list_tasks",
    description: "Returns Remarks tasks for the given project. ...",
    inputSchema: /* JSON Schema derived from zod */,
  },
  handler: async (input: unknown, auth: AuthContext) => {
    const parsed = inputSchema.parse(input);
    if (parsed.project_id !== auth.projectId) {
      throw new McpError("FORBIDDEN", "Token does not grant access to this project");
    }
    const response = await callApi("/v1/projects/:id/annotations", { ...parsed, token: auth.internalToken });
    return { content: [{ type: "text", text: JSON.stringify(formatTasks(response)) }] };
  },
};
```

Each tool is a single file. The pattern is: Zod validation → permission check → call main API → format response.

### 8.4 The Skill resource

```ts
// apps/mcp/src/resources/skill.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

const skillContent = readFileSync(
  join(import.meta.dirname, "../../skills/remarks/SKILL.md"),
  "utf-8",
);

export const skillResource = {
  manifest: {
    uri: "remarks://skill/current",
    name: "Remarks processing methodology",
    description: "Best practices for processing Remarks visual feedback tasks",
    mimeType: "text/markdown",
  },
  content: skillContent,
};
```

The Skill is baked into the Docker image at build time. Updating the Skill is a code deploy. This keeps the distribution mechanism simple; a future phase can make it runtime-loadable if needed.

### 8.5 Dependencies added in Phase 2

- `@modelcontextprotocol/sdk` — official MCP TS SDK (exact version pinned)
- Nothing else. The MCP server reuses `@remarks/shared`, `@remarks/db` is NOT imported (DB access is via API calls only), and `@remarks/mcp-schema` provides the tool-schema package scaffolded in Phase 0.

---

## 9. Observability specific to agent traffic

Agent traffic looks different from human traffic and needs its own slice of observability.

### 9.1 What to log per MCP call

Every MCP tool call logs structured fields:
- `tokenId` (not the token itself)
- `projectId`
- `toolName`
- `durationMs`
- `statusCode` (success/error code)
- `inputSizeBytes`, `outputSizeBytes`
- `clientInfo` from the MCP init handshake (agent name + version, OS)
- `requestId`

These go to Axiom under a separate dataset `mcp-traffic`.

### 9.2 Dashboards to build

Three saved Axiom queries / PostHog dashboards:

1. **Agent adoption** — count of unique tokens active per day, grouped by `clientInfo.agent`. Tells us which agents are actually getting used.
2. **Tool call distribution** — which tools get called most. Informs which tools are valuable vs. ignored.
3. **Agent error rate** — per-agent, per-tool. An agent with a high error rate probably isn't using the Skill well; a tool with a high error rate probably has a spec issue.

### 9.3 Rate-limit alerts

If any single token hits the rate limit more than 10 times in an hour, alert. Probably buggy agent behavior or a loop; could also be a real abuse case.

---

## 10. Phase 2 task breakdown

Estimated ~6 weeks total for a solo developer with Claude Code.

### Week 1: foundation

| # | Task | Done when |
|---|---|---|
| 2.2 ✓ | Scaffold `apps/mcp` with the official [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk); [Build Server Overview](https://modelcontextprotocol.io/docs/develop/build-server#typescript), health check, deployed to Fly | `curl https://mcp.remarks.online/health` returns 200 |
| 2.3 ✓ | Build `packages/mcp-schema` with Zod schemas for all 8 tools from §3 | Exports type-safe tool definitions; imported by api and mcp |
| 2.4 | OAuth resource-server auth on the MCP server: validate Clerk-issued JWTs (signature, `iss`, `aud`, `exp`), 401 with PRM-pointing `WWW-Authenticate` on failure ([ADR-0015](../adr/0015-mcp-oauth-via-clerk.md)) | Integration test: valid JWT → success, expired/wrong-aud/missing → 401 with correct `WWW-Authenticate` |
| 2.5 | Internal API endpoint for MCP server to resolve project membership (`/internal/users/:clerkUserId/projects/:projectId`) and list accessible projects | Integration test passes |

### Week 2: core tools

| # | Task | Done when |
|---|---|---|
| 2.6 | Implement `remarks_whoami` | Integration test: token returns correct project and scopes |
| 2.7 | Implement `remarks_list_tasks` with pagination | Integration test with seeded data |
| 2.8 | Implement `remarks_get_task` with presigned screenshot URL | Integration test returns full context |
| 2.9 | Implement `remarks_get_project_context` | Test returns branches and counts |

### Week 3: mutation tools

| # | Task | Done when |
|---|---|---|
| 2.10 | Implement `remarks_update_task_status` with idempotency key support (Redis) | Integration test: idempotent replay returns cached response |
| 2.11 | Implement `remarks_add_task_comment` | Integration test: event row created with actor_type='agent' |
| 2.12 | Implement `remarks_batch_update_status` with partial-failure support | Test with mix of valid and invalid task IDs |
| 2.13 | Implement `remarks_open_pr` stub (returns `pending_github_integration`) | Test returns correct pending response |

### Week 4: Skill and resource

| # | Task | Done when |
|---|---|---|
| 2.14 | Write `SKILL.md` following §4.2 outline | Reviewed, proofread, ~400 lines |
| 2.15 | Register Skill as MCP resource; serve via `remarks://skill/current` | Integration test: MCP client can fetch resource |
| 2.16 | Add skill version to `remarks_whoami` response | Test passes |
| 2.17 | Test end-to-end with real Claude Code: install token, list tasks, get task, update status | Manual test with real agent |

### Week 5: install experience

| # | Task | Done when |
|---|---|---|
| 2.18 | Dashboard: "Connect Agent" guide page with per-agent install instructions (no token mint — see [ADR-0015](../adr/0015-mcp-oauth-via-clerk.md) §6) | UI renders; copy-paste snippets work; "What happens next" explains OAuth |
| 2.19 | Agent-preset catalog in `apps/dashboard/src/lib/agent-presets.ts` (Claude Code, Cursor, Windsurf, Codex, Copilot, Generic MCP) | Each preset produces correct CLI command + manual JSON snippet |
| 2.20 | (REMOVED — no tokens to create under the OAuth model) | n/a |
| 2.21 | Connected Apps table in account settings: list grants from Clerk, revoke per-grant | Revocation surfaces in Clerk and within 5 min stops further calls |
| 2.22 | Verify Connection button with polling | Success path verified manually |
| 2.23 | Troubleshooting guide / FAQ page | Published at `docs.remarks.dev/agents` |

### Week 6: polish and launch

| # | Task | Done when |
|---|---|---|
| 2.24 | Observability: MCP traffic logging to Axiom with the fields in §9.1 | Queries return data |
| 2.25 | Rate limiting specific to MCP buckets (§5.5) | Load test hits limit at expected rate |
| 2.26 | Hide "Export Markdown" button from dashboard (§10) | Button gone |
| 2.27 | Docs: full MCP tool reference generated from Zod schemas | Hosted on docs.remarks.dev |
| 2.28 | Manual E2E with each supported agent (Claude Code, Cursor, Windsurf) | All three process a real task end-to-end |
| 2.29 | Announcement: launch Phase 2 to existing Phase 1 beta users | Email sent, docs linked |
| 2.30 | Inngest worker `asset-cleanup`: deletes the R2 objects backing `annotation_assets` rows. Triggered on demand by `DELETE /annotations/:id` and the (Phase 3) org-deletion flow; nightly sweep reconciles R2 against the `annotation_assets` table to clean up Phase 1 orphans. First production use of Inngest per phase 0-1 spec §10. | Worker deployed; deleting an annotation removes its R2 objects within 60s; sweep removes a manually-orphaned R2 key on the next run. |

---

## 11. Exit criteria for Phase 2

Phase 2 is done when all of these are true:

- [ ] MCP server deployed at `mcp.remarks.dev` with streamable HTTP transport.
- [ ] All 8 tools from §3 implemented, tested, and documented.
- [ ] Skill published as `remarks://skill/current`, version-stamped, correctly served to clients that request it.
- [ ] Claude Code, Cursor, and Windsurf can each complete the full loop: connect, list_tasks, get_task, update_status to done. Verified manually.
- [ ] Install flow in the dashboard generates correct snippets for all six preset agents.
- [ ] At least 3 Phase 1 beta users have migrated from the markdown export to the MCP integration and report it's better.
- [ ] Rate limiting, auth, and idempotency all enforced and verified.
- [ ] Observability: Axiom dashboards for agent adoption, tool distribution, and error rates all populated.
- [ ] Zero mentions of markdown files in the Phase 2 user-facing documentation.

When all of these are true, Phase 3 (GitHub integration + billing + public launch) begins.

---

## Appendix A: what this spec did not specify

So the next spec author knows what's unresolved.

- **SSE / websocket for agent notifications.** Phase 2 tools are pull-only. If a human marks a task `rejected` while an agent is processing its batch, the agent doesn't find out until its next `get_task` call. This is fine for Phase 2 (agents don't hold tasks in flight for long). An `agent_notifications` push mechanism is a Phase 3+ concern.
- **Per-project consent.** Phase 2 OAuth tokens cover every project the Clerk user can see. The MCP spec's RFC 8707 resource-indicator mechanism would let us issue per-project tokens (`resource=https://mcp.remarks.dev/p/<slug>`) without dashboard changes; deferred until/unless the all-projects model becomes a real problem.
- **Headless / CI service-account tokens.** [ADR-0015](../adr/0015-mcp-oauth-via-clerk.md) removed `project_api_tokens`. A future ADR will spec a Clerk service-account flow for scripted use; not in Phase 2.
- **The `remarks_open_pr` real implementation.** Phase 3, when the GitHub App ships.
- **Design tokens in `remarks_get_project_context`.** Returned as null in Phase 2. Populated in year 2 when the Figma integration ships.
- **Per-scope tokens.** `tasks:read` vs `tasks:write` etc. Reserved in the schema, not exposed in the UI.
- **MCP server stdio transport.** Hosted only in Phase 2. Local / self-hosted MCP is an enterprise feature for later.

Each of these is a reasonable future ADR or mini-spec; none is blocking.
