# 0004. Neon Postgres + Drizzle ORM

Date: 2026-04-21
Status: Accepted

## Context

The data model is relational (users, orgs, projects, branches, annotations, events, assets) with strict foreign-key integrity requirements and an append-only events table that must never lose a row. We want a managed Postgres that supports **database branching** so each PR can preview against an isolated copy of production data, and an ORM that gives us typed queries, migrations in SQL-we-can-read, and a schema that lives in TypeScript so Claude Code can reason about it without leaving the repo.

## Decision

Use **Neon** as our Postgres provider, with branches `main` (prod), `staging`, and `dev`, plus ephemeral branches for CI and preview environments. Use **Drizzle ORM** for schema definition, query building, and migration generation. `packages/db` owns all schema and is the only package allowed to import `drizzle-orm/pg-core`. Migrations are generated with `drizzle-kit generate`, checked into `packages/db/drizzle/`, and applied with `drizzle-kit migrate`. Rewriting an already-applied migration is forbidden (CLAUDE.md §1.10).

## Consequences

Every PR gets a real database to run integration tests against (Testcontainers + Neon branches). Drizzle's SQL-first mindset keeps us close to the actual queries the DB runs — no surprise N+1s from a query builder abstracting too far. Claude Code reads TypeScript schema definitions easily. Cold-start latency on Neon's serverless tier is real (a few hundred ms on a cold branch); we accept it for Phase 0 and will move to a non-serverless plan if it affects UX.

## Alternatives considered

**Supabase Postgres** — excellent but bundled with Supabase Auth, which we don't want (ADR-0003). **Planetscale** — MySQL, no foreign keys in the dev model, less ergonomic for a relational schema this rich. **AWS RDS** — no branching, high operational overhead. **Prisma** — generates a heavy client and migration files that are harder to reason about than Drizzle's SQL output; Claude Code writes Drizzle more reliably. **Kysely** — a fine query builder but no migration tooling of its own.
