# 0001. pnpm workspaces + Turborepo

Date: 2026-04-21
Status: Accepted

## Context

Remarks ships three applications (browser extension, dashboard, API, and later an MCP server) that share significant amounts of code: Drizzle schema, Zod validators, shared error classes, UI primitives. We need one repository that holds all of this, a single dependency graph, and a build tool that can cache across packages so CI and local development stay fast as the codebase grows. Npm and Yarn do not handle large monorepos as efficiently as pnpm, and hand-rolled scripts do not provide the remote-cacheable, topologically-aware task graph that Turborepo does.

## Decision

Use **pnpm 9+ workspaces** as the only package manager (enforced via `packageManager` field and a ban on `npm`/`yarn` in docs and scripts) and **Turborepo** as the task runner for `build`, `lint`, `test`, `typecheck`, and `dev`. Workspace packages live in `apps/*` and `packages/*`; Turborepo enforces the dependency-direction rule from CLAUDE.md §1.3 (apps may depend on packages, packages may not depend on apps, no circular deps).

## Consequences

Installs are fast and disk-efficient (pnpm's content-addressed store), the whole repo shares one lockfile, and Turborepo's task graph means CI only rebuilds what actually changed. Developers must learn the pnpm filter syntax (`pnpm --filter @remarks/api dev`) and any tooling that assumes a flat `node_modules` (older bundlers, some ESLint plugins) can misbehave — a price we accept. Remote caching via Vercel's free tier is available if CI time becomes a concern.

## Alternatives considered

**npm workspaces** — slower, no remote cache story, weaker peer-dep handling. **Yarn 4 with PnP** — powerful but unfamiliar to most of our tooling (VSCode, Biome, some dev servers still expect node_modules). **Nx** — more features than we need and a steeper learning curve; Turborepo is simpler and fits our "thin orchestration, thick services" preference. **Single-repo-no-workspaces** — tried in earlier drafts; shared code ended up duplicated across apps, which is exactly the failure mode we're avoiding.
