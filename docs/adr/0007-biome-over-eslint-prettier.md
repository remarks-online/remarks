# 0007. Biome over ESLint + Prettier

Date: 2026-04-21
Status: Accepted

## Context

A monorepo of this size needs consistent linting and formatting enforced on every commit. ESLint + Prettier is the traditional answer, but the config surface across a multi-package TypeScript + React + Next.js workspace is painful: separate plugins for each framework, conflicting rules between ESLint and Prettier, and notable performance cost on large codebases. Biome is a single Rust-based tool that does both jobs, runs an order of magnitude faster, and has converged on a sensible default ruleset.

## Decision

Use **Biome** as the sole linter and formatter for the entire monorepo. `biome.json` at the repo root is inherited by all packages. Biome runs on pre-commit via `simple-git-hooks` and in CI. Import ordering (external packages → `@remarks/*` workspace → relative) is enforced by Biome. ESLint and Prettier are not installed anywhere in the repo.

## Consequences

Install time drops, lint runs in milliseconds not seconds, and there is one config to read instead of a dozen. We do give up the long tail of ESLint community plugins — some framework-specific rules (e.g., exhaustive React Hooks deps in every edge case) aren't in Biome yet. We accept that; when a missing rule becomes a real problem we'll write a code review note instead of adding back the ESLint tax.

## Alternatives considered

**ESLint + Prettier** — the industry default but slow, fragmented, and produces config files that Claude Code spends tokens reading through. **dprint** — fast formatter but no linter. **Oxc** — promising Rust-based alternative but less mature than Biome as of 2026. **No linter at all, trust the humans** — not credible on a monorepo with an agent making changes.
