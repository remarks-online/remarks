<p align="center">
  <img src="assets/remarks-v4-logo.svg" alt="Remarks" width="140">
</p>

# Remarks

Remarks lets people leave feedback directly on a web page and lets AI coding agents act on it. A Chrome extension pins comments, element selections, region screenshots and tasks to any page. A team dashboard tracks them. An MCP server lets agents such as Claude Code, Cursor, Windsurf and Codex find that feedback, triage it, ask questions about it, and resolve it.

## Status: shelved

I built Remarks solo between April 21 and May 4, 2026. I tried it with several developers and a designer, it didn't stick, and I stopped work on it. Claude and other AI tools have since built similar agent features in.

The hosted deployment is no longer running, so treat this repo as a reference for the design, not a product you can sign up for. It's here mainly to show how the agent side was built.

## How it works

```
Chrome extension ──tRPC──▶ API (Fastify) ──▶ Postgres (Neon)
  capture + screenshots         │         ──▶ Screenshots (Cloudflare R2)
                                │         ──▶ Background jobs (Inngest)
Dashboard (Next.js) ──tRPC──────┘

AI agent ──MCP over HTTP + OAuth──▶ MCP server ──▶ same service layer as the API
```

- **Extension** (`apps/extension`, WXT + React, Manifest V3): annotate an element, a rectangle or a whole route. Captures a screenshot, the CSS selector and, on React apps, the component tree. Annotations queue offline in IndexedDB and upload when the API is reachable.
- **Dashboard** (`apps/dashboard`, Next.js): organizations, projects and branches, personal annotations, a live activity feed over Server-Sent Events, Markdown export, and a "connect your agent" page with install commands and example prompts.
- **API** (`apps/api`, Fastify + tRPC): annotations, uploads, Clerk identity sync, outbound webhooks (Svix), and Inngest jobs that clean up orphaned screenshots.
- **MCP server** (`apps/mcp`): the public interface for agents. Details below.

## The agent contract (MCP)

[ADR-0011](docs/adr/0011-mcp-as-agent-contract.md) makes MCP the product's agent interface: any MCP client can work with Remarks without Remarks-specific code. The server is a thin, stateless adapter (Streamable HTTP) over the same services the REST API uses.

| Tool | What an agent uses it for |
|---|---|
| `remarks_whoami` | Check the connection; list the projects and orgs the token can see |
| `remarks_get_project_context` | Start a session: project metadata and branches with open tasks |
| `remarks_get_pending` / `remarks_get_all_pending` | Triage: work nobody has started, in one project or across all of them |
| `remarks_list_tasks` / `remarks_get_task` | Browse tasks; get one with its selector, screenshot and related tasks |
| `remarks_acknowledge` | "I've seen this", optionally with a clarifying question |
| `remarks_update_task_status` / `remarks_batch_update_status` | Move tasks through `to_do → acknowledged → doing → done` |
| `remarks_add_task_comment` | Ask the human something, or explain a decision |
| `remarks_dismiss` | Reject a task, with a required reason the reviewer sees |
| `remarks_open_pr` | Hand off finished tasks on a branch (a stub: the GitHub integration was never built) |

Design choices worth a look:

- **One schema, two surfaces.** Tool inputs and outputs are Zod schemas in `packages/mcp-schema`, shared with the API, so MCP and REST validate the same way and can't drift.
- **Descriptions written for the model.** Each tool says when to call it and what to call next. For example, `remarks_get_task` tells the agent to check related tasks for ordering before changing code, and to fetch the screenshot only if its model is multimodal.
- **Named verbs for the agent loop.** [ADR-0018](docs/adr/0018-agent-loop-mcp-tools.md) replaced "call the generic status tool with a magic value" with explicit tools: acknowledge, dismiss with a reason, get pending. They came out of a [gap analysis](docs/analysis/2026-04-30-agentation-vs-remarks.md) against an adjacent tool.
- **Safe retries.** Write tools accept an idempotency key, cached for 24 hours in Redis.
- **Standard sign-in.** OAuth 2.1 with dynamic client registration through Clerk, discovered through RFC 9728 protected-resource metadata ([ADR-0015](docs/adr/0015-mcp-oauth-via-clerk.md)). One grant covers every project and org the user belongs to.

Connecting Claude Code looked like this when the server was live:

```sh
claude mcp add --transport http remarks <mcp-server-url>
```

## How it was built

Spec-first, with Claude Code writing the code:

- **[`CLAUDE.md`](CLAUDE.md):** the project's constitution. It covers conventions, dependency direction, schema ownership, testing rules, what the agent must not do, and how to verify work before calling it done.
- **[`docs/plan/`](docs/plan):** phased implementation specs, broken into tasks and executed session by session.
- **[`docs/adr/`](docs/adr):** 20+ architecture decision records, from the monorepo setup to the MCP auth model.
- **[`docs/runbooks/`](docs/runbooks):** setup, local development, deploys and extension distribution.

That came to 127 merged pull requests over the two weeks.

## Repository layout

```
apps/
  api/          Fastify + tRPC API, Inngest jobs, webhooks
  dashboard/    Next.js dashboard
  extension/    Chrome extension (WXT, React, Zustand)
  mcp/          MCP server
packages/
  db/           Drizzle schema and migrations (Postgres)
  mcp-schema/   MCP tool definitions (Zod)
  shared/       Shared types and validation
  ui/           Shared React components (shadcn/ui on Radix)
docs/           ADRs, specs, analyses, runbooks
tools/          Scripts
```

**Stack:** TypeScript, pnpm workspaces and Turborepo, Biome, Zod, Vitest and Playwright. Fastify, tRPC, Drizzle on Neon Postgres, Clerk, Cloudflare R2, Upstash Redis, Inngest, Svix and PostHog. Next.js on Vercel, the API and MCP server on Fly.io, and GitHub Actions for CI and extension releases. The MCP server uses the official TypeScript SDK.

## Running it locally

You'll need Node 22, pnpm 10, Chrome, and your own Clerk, Neon and Cloudflare R2 accounts (MinIO can stand in for R2 locally). Copy each `.env.example` to its local env file and fill in the keys ([`docs/runbooks/setup.md`](docs/runbooks/setup.md) lists the file names and where each value comes from). Then:

```sh
pnpm install
pnpm --filter @remarks/db run db:migrate
pnpm dev
```

Load `apps/extension/.output/chrome-mv3-dev/` as an unpacked extension in Chrome. [`docs/runbooks/local-dev.md`](docs/runbooks/local-dev.md) covers the rest. Both runbooks were written before the MCP server was built, so their notes on it describe a scaffold.
