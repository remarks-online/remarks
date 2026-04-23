# 1. Conventions and constitution

These rules live in `CLAUDE.md` at the repo root and are loaded by Claude Code at the start of every session. Treat them as binding.

## 1.1 Language and versions

- **TypeScript 5.6+ in strict mode** across the entire monorepo. No `any` without an inline `// @ts-expect-error — reason` comment. No `as unknown as T` without a documented justification.
- **Node.js 22 LTS** for all runtime targets. Set `engines.node` in every `package.json` and `.nvmrc` at the repo root.
- **pnpm 9+** as the only package manager. `packageManager` field is set. `npm`/`yarn` commands are banned in docs and scripts.
- **ES modules only.** `"type": "module"` everywhere. No CommonJS except where a dep forces it, in which case document the workaround.

## 1.2 Style and quality

- **Biome** for linting and formatting. Config is at repo root, inherited by all packages. Run on pre-commit via `simple-git-hooks`.
- **Import order:** external packages → `@remarks/*` workspace packages → relative imports. Biome enforces.
- **File names:** `kebab-case.ts` for modules, `PascalCase.tsx` for React components, `use-camel-case.ts` for hooks.
- **Folder names:** `kebab-case`.
- **No default exports** except for Next.js pages/layouts/route handlers (which require them). Named exports everywhere else.
- **No barrel files (`index.ts` re-exports)** except at package public API boundaries. They kill tree-shaking and Claude Code gets confused by them.
- **`packages/*` exposes its public API through a single `src/index.ts`.** Everything else in the package is internal.

## 1.3 Dependency direction

This is non-negotiable and enforced by Turborepo:

- Packages can depend on other packages.
- Apps can depend on packages.
- **Apps cannot depend on other apps.**
- **Packages cannot have circular dependencies.**

If you need code shared between two apps, it goes in a package. If you need a package to use something from an app, the design is wrong.

## 1.4 Schema ownership

- **Database schema lives in `packages/db`.** No other package writes `CREATE TABLE`. No other package imports Drizzle's `pg-core` helpers.
- **Zod schemas for anything crossing a service boundary live in `packages/shared`.** Request/response bodies, event payloads, config files.
- **MCP tool schemas live in `packages/mcp-schema`.** Built in Phase 2 but the package is scaffolded in Phase 0.
- **UI primitives live in `packages/ui`.** shadcn components copied in; extension and dashboard both consume them.

If a type is used in more than one app, it lives in a package. Never duplicate.

## 1.5 Testing rules

- **Unit tests**: Vitest, colocated (`foo.ts` + `foo.test.ts`).
- **Integration tests** (API endpoints hitting a real DB): Vitest against a real Postgres 16 via `DATABASE_URL`, colocated in `apps/api/src/**/*.integration.test.ts`. Each app has its own `vitest.integration.config.ts` (`test:integration` script) and shared harness under `apps/api/test/integration/` that migrates once per run and `TRUNCATE ... RESTART IDENTITY CASCADE`s between tests. Runs with `fileParallelism: false` because all files share one DB. CI provides Postgres as a GitHub Actions service container (`.github/workflows/ci.yml`); locally, point `DATABASE_URL` at any Postgres 16 (a Neon dev branch, `docker run postgres:16`, or a local install). Testcontainers is not used — it was the original plan but was dropped when CI's service container made an external dep unnecessary. Default unit `test` script excludes `*.integration.test.ts`.
- **E2E tests**: Playwright at `apps/*/e2e/*.spec.ts`.
- **Extension tests**: Playwright with `@playwright/test` — launches Chromium with the extension loaded.
- **Coverage target: 70% lines for `packages/*`, no target for `apps/*`.** Integration and E2E give better signal than unit coverage for app code.
- **Write the test first** for any non-trivial feature. Claude Code produces noticeably better code when it has a failing test to target.

## 1.6 Git and PR rules

- **Branch naming**: `type/short-description` — e.g., `feat/annotation-rectangle-drawing`, `fix/screenshot-dpi-scaling`, `chore/upgrade-next-15`.
- **Commit convention**: Conventional Commits. `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`. Scope optional.
- **PR titles** match the primary commit. **PR bodies** explain why, not what.
- **Squash-merge only.** Rebase is banned because it rewrites history in confusing ways.
- **No long-lived branches.** Merge daily if possible.
- **`main` is always deployable.** Broken `main` is a stop-the-world event.

## 1.7 ADRs (Architectural Decision Records)

Every architectural decision gets an ADR in `docs/adr/NNNN-short-title.md` using this template:

```markdown
# NNNN. Title

Date: YYYY-MM-DD
Status: Proposed | Accepted | Superseded by ADR-NNNN

## Context
What problem are we solving? What constraints apply?

## Decision
What did we decide?

## Consequences
What follows from this decision? Tradeoffs?

## Alternatives considered
What else did we look at and why not?
```

Phase 0 ships with pre-written ADRs for: pnpm+Turbo, Clerk, Neon, Fly, Vercel, Drizzle, Biome, Zod-everywhere, WXT, tRPC-for-dashboard-only, MCP-as-agent-contract.

## 1.8 Environment variables

- **One `.env.example` per app**, checked in. Lists every variable with a comment explaining it.
- **`.env.local` is gitignored.** Never commit secrets.
- **Secrets in production** come from the hosting provider's secret store (Vercel env, Fly secrets, GitHub Actions secrets). Never from a `.env` file in prod.
- **Typed env access**: each app has a `src/env.ts` that validates `process.env` with Zod at boot. The app crashes if env is invalid.

```ts
// apps/api/src/env.ts
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  DATABASE_URL: z.string().url(),
  CLERK_SECRET_KEY: z.string().startsWith("sk_"),
  CLERK_PUBLISHABLE_KEY: z.string().startsWith("pk_"),
  R2_ACCOUNT_ID: z.string(),
  R2_ACCESS_KEY_ID: z.string(),
  R2_SECRET_ACCESS_KEY: z.string(),
  R2_BUCKET_SCREENSHOTS: z.string(),
  UPSTASH_REDIS_URL: z.string().url(),
  INNGEST_EVENT_KEY: z.string(),
  INNGEST_SIGNING_KEY: z.string(),
  RESEND_API_KEY: z.string().startsWith("re_"),
  SENTRY_DSN: z.string().url().optional(),
  POSTHOG_API_KEY: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
```

## 1.9 Error handling

- **Never throw raw strings.** Always `throw new SomeError(message, { cause })`.
- **App-specific error classes** extend a base `RemarksError` in `packages/shared/src/errors.ts` with `code`, `statusCode`, and `exposed` (whether the message can be shown to the client).
- **Server-side errors are logged with structured fields** (userId, orgId, requestId) and reported to Sentry.
- **Client-side errors go to Sentry** with Clerk user context attached.

## 1.10 What Claude Code must not do

These are hard rules. When running, Claude Code reads this list and refuses to do these things without explicit human override:

- Rewrite migrations that have already been applied to any environment.
- Change the Drizzle schema without also writing a migration.
- Modify anything in `docs/adr/*` except to create a new ADR.
- Add a new runtime dependency without noting it in the PR description and justifying why an existing dep isn't sufficient.
- Introduce a new hosting provider or managed service.
- Commit secrets, API keys, or `.env.local` files.
- Merge to `main` with failing CI.
- Disable tests to make CI pass.
- Use `any` or `@ts-ignore` without a justification comment.
- Skip the Zod validation on env vars or on API request/response bodies.

## 1.11 Verification before reporting a task done

Before reporting a numbered §13/§14 task (or a `docs/plan/spec-gaps.md` amendment) as complete, **run the checks yourself.** Don't list the commands and hand them to the human — execute them and report the results. Listing "here's what you should run" is a failure mode; the harness has the tools to verify, so use them.

Run in this order, stopping on the first failure:

1. `pnpm turbo typecheck --filter="*"` — every package, not just the affected set
2. `pnpm turbo lint --filter="*"` — Biome clean (auto-fix with `biome check --write` on specific paths)
3. `pnpm turbo test --filter="*"` — unit suites
4. Integration tests for any API or schema change:
   `cd apps/api && set -a && source .env.local && set +a && export R2_S3_ENDPOINT=http://localhost:9000 && pnpm vitest run --config vitest.integration.config.ts`
   Prereqs: MinIO running (`pnpm minio:up`) and `DATABASE_URL` reachable. These tests `TRUNCATE ... RESTART IDENTITY CASCADE` — the dev DB is the target by design.
5. E2E tests for any dashboard UI change: `pnpm --filter @remarks/dashboard test:e2e` (reuses the `signedInPage` fixture; writes throwaway DB state per spec)
6. `pnpm turbo build --filter="*"` — every app builds

The `--filter="*"` flag is load-bearing: bare `pnpm turbo <task>` only runs in packages whose inputs changed in the git working tree, which can silently skip packages whose inputs changed transitively (e.g., a `@remarks/shared` edit that affects dashboard typecheck).

Only skip a step when the change can't affect it (e.g., no UI changes → skip E2E). Be explicit about what was skipped and why.

If a step genuinely requires human intervention — a credential you don't have, a destructive action that needs confirmation, an external service that's down — say so with the exact command the dev needs to run and the reason you can't run it yourself. Don't dress up "you should run this" as verification.
