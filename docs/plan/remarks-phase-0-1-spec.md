# Remarks: Phase 0 + Phase 1 Implementation Spec

This document is the executable spec for the first ~5 months of work. It is written to be handed to Claude Code session-by-session. Everything it says is binding unless you explicitly change it in an ADR.

**Scope of this doc:**
- Phase 0 (weeks 1–2): Foundation. Monorepo, infra accounts, `hello world` deploys end-to-end.
- Phase 1 (weeks 3–20): Capture + cloud sync MVP. Solo/free tier feature-complete, ready for private beta.

**Out of scope for this doc:** MCP server (Phase 2), GitHub integration (Phase 3), billing/launch (Phase 3), Figma/policy/review (year 2). Those get their own specs written when Phase 1 is done, not now.

---

## Table of contents

1. [Conventions and constitution](#1-conventions-and-constitution)
2. [Monorepo structure](#2-monorepo-structure)
3. [Data model (Drizzle schemas)](#3-data-model-drizzle-schemas)
4. [Shared types and Zod schemas](#4-shared-types-and-zod-schemas)
5. [API contract](#5-api-contract)
6. [Extension architecture](#6-extension-architecture)
7. [Dashboard architecture](#7-dashboard-architecture)
8. [Infrastructure setup](#8-infrastructure-setup)
9. [CI/CD and deployment](#9-cicd-and-deployment)
10. [Testing strategy](#10-testing-strategy)
11. [Observability](#11-observability)
12. [Security baseline](#12-security-baseline)
13. [Phase 0 task breakdown](#13-phase-0-task-breakdown)
14. [Phase 1 task breakdown](#14-phase-1-task-breakdown)
15. [Exit criteria for Phase 1](#15-exit-criteria-for-phase-1)

---

## 1. Conventions and constitution

These rules live in `CLAUDE.md` at the repo root and are loaded by Claude Code at the start of every session. Treat them as binding.

### 1.1 Language and versions

- **TypeScript 5.6+ in strict mode** across the entire monorepo. No `any` without an inline `// @ts-expect-error — reason` comment. No `as unknown as T` without a documented justification.
- **Node.js 22 LTS** for all runtime targets. Set `engines.node` in every `package.json` and `.nvmrc` at the repo root.
- **pnpm 9+** as the only package manager. `packageManager` field is set. `npm`/`yarn` commands are banned in docs and scripts.
- **ES modules only.** `"type": "module"` everywhere. No CommonJS except where a dep forces it, in which case document the workaround.

### 1.2 Style and quality

- **Biome** for linting and formatting. Config is at repo root, inherited by all packages. Run on pre-commit via `simple-git-hooks`.
- **Import order:** external packages → `@remarks/*` workspace packages → relative imports. Biome enforces.
- **File names:** `kebab-case.ts` for modules, `PascalCase.tsx` for React components, `use-camel-case.ts` for hooks.
- **Folder names:** `kebab-case`.
- **No default exports** except for Next.js pages/layouts/route handlers (which require them). Named exports everywhere else.
- **No barrel files (`index.ts` re-exports)** except at package public API boundaries. They kill tree-shaking and Claude Code gets confused by them.
- **`packages/*` exposes its public API through a single `src/index.ts`.** Everything else in the package is internal.

### 1.3 Dependency direction

This is non-negotiable and enforced by Turborepo:

- Packages can depend on other packages.
- Apps can depend on packages.
- **Apps cannot depend on other apps.**
- **Packages cannot have circular dependencies.**

If you need code shared between two apps, it goes in a package. If you need a package to use something from an app, the design is wrong.

### 1.4 Schema ownership

- **Database schema lives in `packages/db`.** No other package writes `CREATE TABLE`. No other package imports Drizzle's `pg-core` helpers.
- **Zod schemas for anything crossing a service boundary live in `packages/shared`.** Request/response bodies, event payloads, config files.
- **MCP tool schemas live in `packages/mcp-schema`.** Built in Phase 2 but the package is scaffolded in Phase 0.
- **UI primitives live in `packages/ui`.** shadcn components copied in; extension and dashboard both consume them.

If a type is used in more than one app, it lives in a package. Never duplicate.

### 1.5 Testing rules

- **Unit tests**: Vitest, colocated (`foo.ts` + `foo.test.ts`).
- **Integration tests** (API endpoints hitting a real DB): Vitest + Testcontainers for ephemeral Postgres, colocated in `apps/api/src/**/*.integration.test.ts`.
- **E2E tests**: Playwright at `apps/*/e2e/*.spec.ts`.
- **Extension tests**: Playwright with `@playwright/test` — launches Chromium with the extension loaded.
- **Coverage target: 70% lines for `packages/*`, no target for `apps/*`.** Integration and E2E give better signal than unit coverage for app code.
- **Write the test first** for any non-trivial feature. Claude Code produces noticeably better code when it has a failing test to target.

### 1.6 Git and PR rules

- **Branch naming**: `type/short-description` — e.g., `feat/annotation-rectangle-drawing`, `fix/screenshot-dpi-scaling`, `chore/upgrade-next-15`.
- **Commit convention**: Conventional Commits. `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`. Scope optional.
- **PR titles** match the primary commit. **PR bodies** explain why, not what.
- **Squash-merge only.** Rebase is banned because it rewrites history in confusing ways.
- **No long-lived branches.** Merge daily if possible.
- **`main` is always deployable.** Broken `main` is a stop-the-world event.

### 1.7 ADRs (Architectural Decision Records)

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

### 1.8 Environment variables

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

### 1.9 Error handling

- **Never throw raw strings.** Always `throw new SomeError(message, { cause })`.
- **App-specific error classes** extend a base `RemarksError` in `packages/shared/src/errors.ts` with `code`, `statusCode`, and `exposed` (whether the message can be shown to the client).
- **Server-side errors are logged with structured fields** (userId, orgId, requestId) and reported to Sentry.
- **Client-side errors go to Sentry** with Clerk user context attached.

### 1.10 What Claude Code must not do

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

---

## 2. Monorepo structure

Exact layout. Claude Code should treat this as the authoritative skeleton:

```
remarks/
├── .changeset/                    # only if we publish packages (we don't in year 1)
├── .github/
│   └── workflows/
│       ├── ci.yml                 # lint + test on every PR
│       ├── deploy-api.yml         # deploy api + mcp to Fly on main
│       ├── deploy-dashboard.yml   # Vercel auto-deploys; this is a fallback
│       └── release-extension.yml  # on tag: build and upload extension zips
├── apps/
│   ├── extension/                 # WXT browser extension
│   │   ├── src/
│   │   │   ├── entrypoints/
│   │   │   │   ├── background.ts
│   │   │   │   ├── content.ts
│   │   │   │   ├── content.css
│   │   │   │   └── popup/
│   │   │   │       ├── App.tsx
│   │   │   │       └── index.html
│   │   │   ├── components/        # React UI (sidebar, comment form, etc.)
│   │   │   ├── lib/               # API client, storage wrapper, capture
│   │   │   ├── hooks/
│   │   │   └── types.ts
│   │   ├── public/
│   │   │   └── icons/
│   │   ├── e2e/
│   │   ├── wxt.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── dashboard/                 # Next.js 15 App Router, on Vercel
│   │   ├── src/
│   │   │   ├── app/               # App Router tree
│   │   │   │   ├── (marketing)/
│   │   │   │   ├── (app)/
│   │   │   │   │   ├── layout.tsx
│   │   │   │   │   ├── projects/
│   │   │   │   │   └── settings/
│   │   │   │   ├── api/
│   │   │   │   │   └── webhooks/
│   │   │   │   └── layout.tsx
│   │   │   ├── components/
│   │   │   ├── lib/
│   │   │   │   ├── trpc.ts
│   │   │   │   └── auth.ts
│   │   │   └── env.ts
│   │   ├── next.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── api/                       # Fastify on Fly.io
│   │   ├── src/
│   │   │   ├── server.ts          # Fastify app factory
│   │   │   ├── index.ts           # entry (starts server)
│   │   │   ├── env.ts
│   │   │   ├── plugins/
│   │   │   │   ├── auth.ts        # Clerk JWT verification
│   │   │   │   ├── logger.ts
│   │   │   │   ├── sentry.ts
│   │   │   │   └── rate-limit.ts
│   │   │   ├── routes/
│   │   │   │   ├── health.ts
│   │   │   │   ├── annotations/
│   │   │   │   │   ├── index.ts
│   │   │   │   │   ├── create.ts
│   │   │   │   │   ├── list.ts
│   │   │   │   │   ├── get.ts
│   │   │   │   │   ├── update.ts
│   │   │   │   │   └── delete.ts
│   │   │   │   ├── uploads/       # pre-signed R2 URLs
│   │   │   │   ├── projects/
│   │   │   │   └── webhooks/
│   │   │   ├── trpc/              # tRPC routers (for dashboard only)
│   │   │   │   ├── context.ts
│   │   │   │   ├── router.ts
│   │   │   │   └── procedures/
│   │   │   ├── services/          # business logic; thin routes → thick services
│   │   │   │   ├── annotations.service.ts
│   │   │   │   ├── uploads.service.ts
│   │   │   │   └── projects.service.ts
│   │   │   └── lib/
│   │   │       ├── r2.ts
│   │   │       ├── redis.ts
│   │   │       └── inngest.ts
│   │   ├── Dockerfile
│   │   ├── fly.toml
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── mcp/                       # MCP server, scaffolded in Phase 0, built in Phase 2
│       ├── src/
│       │   ├── index.ts
│       │   └── env.ts
│       ├── Dockerfile
│       ├── fly.toml
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   ├── db/                        # Drizzle
│   │   ├── src/
│   │   │   ├── schema/
│   │   │   │   ├── index.ts
│   │   │   │   ├── organizations.ts
│   │   │   │   ├── users.ts
│   │   │   │   ├── projects.ts
│   │   │   │   ├── annotations.ts
│   │   │   │   └── _relations.ts
│   │   │   ├── client.ts
│   │   │   ├── migrate.ts
│   │   │   └── index.ts
│   │   ├── drizzle/               # generated migrations (committed)
│   │   ├── drizzle.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── shared/                    # Zod schemas, types, constants, errors
│   │   ├── src/
│   │   │   ├── schemas/
│   │   │   │   ├── annotation.ts
│   │   │   │   ├── project.ts
│   │   │   │   └── common.ts
│   │   │   ├── types/
│   │   │   ├── errors.ts
│   │   │   ├── constants.ts
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── ui/                        # shared React components (shadcn)
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── styles/
│   │   │   └── index.ts
│   │   ├── components.json        # shadcn config
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── mcp-schema/                # scaffolded in Phase 0, built in Phase 2
│       ├── src/
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
├── docs/
│   ├── adr/
│   │   ├── 0001-pnpm-and-turborepo.md
│   │   ├── 0002-managed-saas-year-1.md
│   │   ├── 0003-clerk-for-auth.md
│   │   ├── 0004-neon-postgres-and-drizzle.md
│   │   ├── 0005-fly-for-api-hosting.md
│   │   ├── 0006-vercel-for-dashboard.md
│   │   ├── 0007-biome-over-eslint-prettier.md
│   │   ├── 0008-zod-for-all-boundaries.md
│   │   ├── 0009-wxt-for-extension.md
│   │   ├── 0010-trpc-for-dashboard-only.md
│   │   ├── 0011-mcp-as-agent-contract.md
│   │   ├── 0012-cloudflare-r2-for-screenshots.md
│   │   └── 0013-inngest-for-background-jobs.md
│   ├── skills/                    # Claude Code skill packs
│   │   ├── add-api-endpoint/
│   │   ├── add-drizzle-table/
│   │   └── add-dashboard-page/
│   ├── runbooks/
│   └── api/                       # public API docs, generated
├── tools/
│   └── scripts/
│       ├── seed.ts                # seed dev database
│       └── reset-dev.ts
├── CLAUDE.md                      # project constitution, loaded by Claude Code
├── README.md
├── biome.json
├── package.json                   # root — pnpm workspace
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── .nvmrc
├── .gitignore
└── .env.example                   # every env var across all apps
```

### 2.1 pnpm workspace definition

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
```

### 2.2 Turborepo pipeline

```json
// turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": [".env", "tsconfig.base.json"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", ".output/**", ".wxt/**"]
    },
    "lint": {},
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "test:integration": {
      "dependsOn": ["^build"],
      "env": ["DATABASE_URL"]
    },
    "test:e2e": {
      "dependsOn": ["build"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "db:generate": {
      "cache": false
    },
    "db:migrate": {
      "cache": false
    }
  }
}
```

### 2.3 Base tsconfig

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "allowUnreachableCode": false,
    "allowUnusedLabels": false,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "incremental": true
  }
}
```

Each app/package extends this with its own `tsconfig.json` that sets `outDir`, `rootDir`, and any app-specific needs.

---

## 3. Data model (Drizzle schemas)

These are the Phase 1 tables. Phase 2+ tables (design_systems, tokens, policies, etc.) are deferred — do not add them yet.

### 3.1 Core identity

```ts
// packages/db/src/schema/organizations.ts
import { pgTable, text, timestamp, uuid, pgEnum } from "drizzle-orm/pg-core";

export const planEnum = pgEnum("plan", ["free", "team", "business"]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkOrgId: text("clerk_org_id").notNull().unique(),  // sync key from Clerk
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: planEnum("plan").notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
```

```ts
// packages/db/src/schema/users.ts
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

Note: we mirror Clerk's identity into Postgres via webhooks. Clerk is source of truth for auth; our DB owns authorization (who can do what in which project).

### 3.2 Projects and branches

```ts
// packages/db/src/schema/projects.ts
import { pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    gitRepoUrl: text("git_repo_url"),            // null until GitHub integration (Phase 3)
    primaryBranch: text("primary_branch").notNull().default("main"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgSlugIdx: uniqueIndex("projects_org_slug_idx").on(table.orgId, table.slug),
  }),
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
```

```ts
// packages/db/src/schema/branches.ts
import { pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { projects } from "./projects";

export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    gitSha: text("git_sha"),                     // populated by GitHub integration
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectNameIdx: uniqueIndex("branches_project_name_idx").on(table.projectId, table.name),
  }),
);

export type Branch = typeof branches.$inferSelect;
```

Branches are created lazily the first time an annotation references them. No UI for managing branches in Phase 1 — they just show up as groupings.

### 3.3 Annotations

```ts
// packages/db/src/schema/annotations.ts
import {
  pgTable, text, timestamp, uuid, jsonb, pgEnum, index, integer,
} from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { branches } from "./branches";
import { users } from "./users";

export const annotationStatusEnum = pgEnum("annotation_status", [
  "to_do", "doing", "done", "rejected",
]);

export const annotationTargetTypeEnum = pgEnum("annotation_target_type", [
  "element",      // clicked a DOM element
  "rectangle",    // drew a freeform rectangle
  "route",        // applies to whole route/page
]);

export const annotations = pgTable(
  "annotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").notNull().references(() => branches.id),
    authorId: uuid("author_id").notNull().references(() => users.id),
    status: annotationStatusEnum("status").notNull().default("to_do"),
    targetType: annotationTargetTypeEnum("target_type").notNull(),

    // captured context
    url: text("url").notNull(),
    targetSelector: text("target_selector"),          // CSS selector for element mode
    targetCoords: jsonb("target_coords").$type<{
      x: number; y: number; width: number; height: number;
    } | null>(),                                      // for rectangle mode (doc-relative px)
    viewport: jsonb("viewport").$type<{
      width: number; height: number; dpr: number;
    }>().notNull(),
    domContext: jsonb("dom_context").$type<{
      tagName?: string;
      classes?: string[];
      textContent?: string;
      computedStyles?: Record<string, string>;
      ancestors?: Array<{ tagName: string; classes?: string[] }>;
    } | null>(),
    frameworkHint: text("framework_hint"),            // "react", "vue", "svelte", etc., if detected

    commentText: text("comment_text").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectStatusIdx: index("annotations_project_status_idx").on(table.projectId, table.status),
    branchIdx: index("annotations_branch_idx").on(table.branchId),
    authorIdx: index("annotations_author_idx").on(table.authorId),
    createdAtIdx: index("annotations_created_at_idx").on(table.createdAt),
  }),
);

export type Annotation = typeof annotations.$inferSelect;
export type NewAnnotation = typeof annotations.$inferInsert;
```

### 3.4 Annotation events (append-only)

```ts
// packages/db/src/schema/annotation-events.ts
import { pgTable, text, timestamp, uuid, jsonb, pgEnum, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { annotations } from "./annotations";
import { users } from "./users";
import { projectApiTokens } from "./project-api-tokens";

export const annotationEventTypeEnum = pgEnum("annotation_event_type", [
  "created", "status_changed", "comment_added", "assigned",
  "pr_linked", "asset_attached", "resolved",
  "agent_updated_status",   // emitted when an agent (not a human) calls update_status
  "agent_commented",        // emitted when an agent calls add_task_comment
]);

export const eventActorTypeEnum = pgEnum("event_actor_type", ["user", "agent", "system"]);

export const annotationEvents = pgTable(
  "annotation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    annotationId: uuid("annotation_id").notNull().references(() => annotations.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id),    // null when actor_type is 'agent' or 'system'
    actorType: eventActorTypeEnum("actor_type").notNull().default("user"),
    actorTokenId: uuid("actor_token_id").references(() => projectApiTokens.id),  // non-null only when actor_type is 'agent'
    type: annotationEventTypeEnum("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    actorConsistency: check(
      "annotation_events_actor_consistency",
      sql`
        (${table.actorType} = 'user' AND ${table.actorId} IS NOT NULL AND ${table.actorTokenId} IS NULL) OR
        (${table.actorType} = 'agent' AND ${table.actorId} IS NULL AND ${table.actorTokenId} IS NOT NULL) OR
        (${table.actorType} = 'system' AND ${table.actorId} IS NULL AND ${table.actorTokenId} IS NULL)
      `,
    ),
  }),
);

export type AnnotationEvent = typeof annotationEvents.$inferSelect;
```

**Rules for events:**
- Never updated, never deleted (except by cascade when annotation itself is deleted).
- Any state mutation on an annotation writes an event.
- Claude Code must not add UPDATE or DELETE statements against this table.

### 3.5 Annotation assets

```ts
// packages/db/src/schema/annotation-assets.ts
import { pgTable, text, timestamp, uuid, jsonb, pgEnum, integer } from "drizzle-orm/pg-core";
import { annotations } from "./annotations";

export const assetKindEnum = pgEnum("asset_kind", ["screenshot", "video", "dom_snapshot"]);

export const annotationAssets = pgTable("annotation_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  annotationId: uuid("annotation_id").notNull().references(() => annotations.id, { onDelete: "cascade" }),
  kind: assetKindEnum("kind").notNull(),
  r2Key: text("r2_key").notNull(),                 // path within bucket
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

### 3.6 Project members (authorization)

```ts
// packages/db/src/schema/project-members.ts
import { pgTable, uuid, pgEnum, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { users } from "./users";

export const projectRoleEnum = pgEnum("project_role", ["admin", "editor", "viewer"]);

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: projectRoleEnum("role").notNull().default("editor"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectId, table.userId] }),
  }),
);
```

Org membership comes from Clerk Orgs. Project membership is ours — this is what gets checked on every authorization decision.

### 3.7 Relations

```ts
// packages/db/src/schema/_relations.ts
import { relations } from "drizzle-orm";
import { organizations } from "./organizations";
import { projects } from "./projects";
import { branches } from "./branches";
import { annotations } from "./annotations";
import { annotationEvents } from "./annotation-events";
import { annotationAssets } from "./annotation-assets";
import { projectMembers } from "./project-members";
import { users } from "./users";

export const organizationsRelations = relations(organizations, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  org: one(organizations, { fields: [projects.orgId], references: [organizations.id] }),
  branches: many(branches),
  annotations: many(annotations),
  members: many(projectMembers),
}));

export const branchesRelations = relations(branches, ({ one, many }) => ({
  project: one(projects, { fields: [branches.projectId], references: [projects.id] }),
  annotations: many(annotations),
}));

export const annotationsRelations = relations(annotations, ({ one, many }) => ({
  project: one(projects, { fields: [annotations.projectId], references: [projects.id] }),
  branch: one(branches, { fields: [annotations.branchId], references: [branches.id] }),
  author: one(users, { fields: [annotations.authorId], references: [users.id] }),
  events: many(annotationEvents),
  assets: many(annotationAssets),
}));

// ... etc
```

### 3.8 Row-level security (deferred)

RLS is correct for enterprise and you want it eventually, but adding it now is a premature-optimization tax for a pre-revenue product. Phase 1: enforce authorization at the service layer only. Phase 4+ (when Business tier ships), layer on RLS as defense in depth.

### 3.8 Project API tokens

```ts
// packages/db/src/schema/project-api-tokens.ts
import { pgTable, text, timestamp, uuid, jsonb, index } from "drizzle-orm/pg-core";
import { projects } from "./projects";
import { users } from "./users";

export const projectApiTokens = pgTable(
  "project_api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),                              // user-supplied, e.g., "Claude Code on my laptop"
    tokenHash: text("token_hash").notNull().unique(),
    tokenPrefix: text("token_prefix").notNull(),              // first 12 chars for display
    tokenLast4: text("token_last_4").notNull(),               // last 4 for display
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    createdById: uuid("created_by_id").notNull().references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    clientInfo: jsonb("client_info").$type<{
      agent?: string;
      version?: string;
      os?: string;
    } | null>(),                                               // populated from MCP init handshake
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectIdx: index("project_api_tokens_project_idx").on(table.projectId),
    lastUsedIdx: index("project_api_tokens_last_used_idx").on(table.lastUsedAt),
  }),
);
```

---

## 4. Shared types and Zod schemas

These live in `packages/shared` and are the contract between every app.

### 4.1 Annotation schemas

```ts
// packages/shared/src/schemas/annotation.ts
import { z } from "zod";

export const annotationStatusSchema = z.enum(["to_do", "doing", "done", "rejected"]);
export type AnnotationStatus = z.infer<typeof annotationStatusSchema>;

export const annotationTargetTypeSchema = z.enum(["element", "rectangle", "route"]);

export const viewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  dpr: z.number().positive(),
});

export const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

export const domContextSchema = z.object({
  tagName: z.string().optional(),
  classes: z.array(z.string()).optional(),
  textContent: z.string().max(500).optional(),
  computedStyles: z.record(z.string(), z.string()).optional(),
  ancestors: z.array(z.object({
    tagName: z.string(),
    classes: z.array(z.string()).optional(),
  })).optional(),
});

export const createAnnotationRequestSchema = z.object({
  projectId: z.string().uuid(),
  branch: z.string().min(1).max(255),
  targetType: annotationTargetTypeSchema,
  url: z.string().url(),
  targetSelector: z.string().max(2000).optional(),
  targetCoords: rectSchema.optional(),
  viewport: viewportSchema,
  domContext: domContextSchema.optional(),
  frameworkHint: z.string().optional(),
  commentText: z.string().min(1).max(5000),
  // Client uploads screenshot separately and references it:
  screenshotAssetId: z.string().uuid().optional(),
}).refine(
  (data) => {
    if (data.targetType === "element") return !!data.targetSelector;
    if (data.targetType === "rectangle") return !!data.targetCoords;
    return true;
  },
  { message: "Element annotations need selector; rectangle annotations need coords" },
);

export type CreateAnnotationRequest = z.infer<typeof createAnnotationRequestSchema>;

export const annotationResponseSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  branchId: z.string().uuid(),
  branchName: z.string(),
  status: annotationStatusSchema,
  targetType: annotationTargetTypeSchema,
  url: z.string().url(),
  targetSelector: z.string().nullable(),
  targetCoords: rectSchema.nullable(),
  viewport: viewportSchema,
  commentText: z.string(),
  author: z.object({
    id: z.string().uuid(),
    name: z.string().nullable(),
    email: z.string().email(),
    avatarUrl: z.string().url().nullable(),
  }),
  assets: z.array(z.object({
    id: z.string().uuid(),
    kind: z.enum(["screenshot", "video", "dom_snapshot"]),
    url: z.string().url(),     // presigned
    contentType: z.string(),
  })),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type AnnotationResponse = z.infer<typeof annotationResponseSchema>;

export const updateAnnotationRequestSchema = z.object({
  status: annotationStatusSchema.optional(),
  commentText: z.string().min(1).max(5000).optional(),
}).refine(
  (data) => data.status !== undefined || data.commentText !== undefined,
  { message: "At least one field must be provided" },
);

export type UpdateAnnotationRequest = z.infer<typeof updateAnnotationRequestSchema>;
```

### 4.2 Project schemas

```ts
// packages/shared/src/schemas/project.ts
import { z } from "zod";

export const projectRoleSchema = z.enum(["admin", "editor", "viewer"]);

export const createProjectRequestSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with dashes"),
  gitRepoUrl: z.string().url().optional(),
  primaryBranch: z.string().default("main"),
});

export const projectResponseSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  gitRepoUrl: z.string().url().nullable(),
  primaryBranch: z.string(),
  // apiToken is returned only on create and on explicit rotation endpoint
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
```

### 4.3 Upload schemas

```ts
// packages/shared/src/schemas/common.ts
import { z } from "zod";

export const presignedUploadRequestSchema = z.object({
  projectId: z.string().uuid(),
  kind: z.enum(["screenshot", "video", "dom_snapshot"]),
  contentType: z.string().regex(/^[a-z]+\/[a-zA-Z0-9.+-]+$/),
  sizeBytes: z.number().int().positive().max(50_000_000),   // 50 MB max
});

export const presignedUploadResponseSchema = z.object({
  assetId: z.string().uuid(),
  uploadUrl: z.string().url(),
  fields: z.record(z.string(), z.string()).optional(),       // if using POST policy
  expiresAt: z.string().datetime(),
});
```

### 4.4 Errors

```ts
// packages/shared/src/errors.ts
export class RemarksError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly exposed: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends RemarksError {
  constructor(message: string, public readonly issues?: unknown) {
    super(message, "VALIDATION_ERROR", 400, true);
  }
}

export class UnauthorizedError extends RemarksError {
  constructor(message = "Unauthorized") {
    super(message, "UNAUTHORIZED", 401, true);
  }
}

export class ForbiddenError extends RemarksError {
  constructor(message = "Forbidden") {
    super(message, "FORBIDDEN", 403, true);
  }
}

export class NotFoundError extends RemarksError {
  constructor(resource: string) {
    super(`${resource} not found`, "NOT_FOUND", 404, true);
  }
}

export class ConflictError extends RemarksError {
  constructor(message: string) {
    super(message, "CONFLICT", 409, true);
  }
}

export class RateLimitError extends RemarksError {
  constructor(message = "Rate limit exceeded") {
    super(message, "RATE_LIMIT", 429, true);
  }
}

export class InternalError extends RemarksError {
  constructor(message: string, cause?: unknown) {
    super(message, "INTERNAL_ERROR", 500, false, { cause });
  }
}
```

---

## 5. API contract

The API is REST-first, with a tRPC router layered on top for the dashboard only. REST is for the extension (stable contract, easy to version), tRPC is for the dashboard (type safety, no versioning friction when shipping together).

### 5.1 Authentication

- **Dashboard → API**: Clerk session token (Bearer) in `Authorization` header. Verified via `@clerk/backend`.
- **Extension → API**: Clerk session token (Bearer). Extension uses Clerk's Chrome extension SDK to get a JWT.
- **Agent/MCP → API (Phase 2)**: Project API token in `Authorization: Bearer db_proj_xxx`. Scoped to a single project. Rotatable.

All routes require auth except `/health` and webhooks (which use signature verification, not bearer auth).

### 5.2 REST endpoints (Phase 1)

Base URL: `https://api.remarks.online/v1`

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/health` | Liveness | None |
| GET | `/health/ready` | Readiness (checks DB + Redis) | None |
| POST | `/webhooks/clerk` | Clerk user/org sync | Clerk signature |
| GET | `/me` | Current user + orgs | User |
| GET | `/orgs/:orgId/projects` | List projects in org | User (org member) |
| POST | `/orgs/:orgId/projects` | Create project | User (org admin) |
| GET | `/projects/:projectId` | Get project detail | User (project member) |
| PATCH | `/projects/:projectId` | Update project | User (project admin) |
| DELETE | `/projects/:projectId` | Delete project | User (project admin) |
| POST | `/projects/:projectId/rotate-token` | New API token | User (project admin) |
| GET | `/projects/:projectId/annotations` | List annotations (paginated, filterable) | User (project member) |
| POST | `/projects/:projectId/annotations` | Create annotation | User (project editor+) |
| GET | `/annotations/:annotationId` | Get annotation detail | User (project member) |
| PATCH | `/annotations/:annotationId` | Update status / comment | User (project editor+ or author) |
| DELETE | `/annotations/:annotationId` | Delete | User (project admin or author) |
| GET | `/annotations/:annotationId/events` | Event log | User (project member) |
| POST | `/uploads/presign` | Get presigned R2 upload URL | User |

### 5.3 Request/response examples

**POST /projects/:projectId/annotations**

Request:
```json
{
  "branch": "feature/checkout-redesign",
  "targetType": "element",
  "url": "https://staging.acme.com/checkout",
  "targetSelector": "body > main > form > button.submit",
  "viewport": { "width": 1920, "height": 1080, "dpr": 2 },
  "domContext": {
    "tagName": "BUTTON",
    "classes": ["submit", "primary"],
    "textContent": "Place order",
    "computedStyles": {
      "background-color": "rgb(79, 70, 229)",
      "padding": "12px 24px"
    }
  },
  "frameworkHint": "react",
  "commentText": "This button should use our brand green, not purple",
  "screenshotAssetId": "3f2a1b7c-..."
}
```

Response (201):
```json
{
  "id": "a1b2c3d4-...",
  "projectId": "...",
  "branchId": "...",
  "branchName": "feature/checkout-redesign",
  "status": "to_do",
  "targetType": "element",
  "url": "https://staging.acme.com/checkout",
  "targetSelector": "body > main > form > button.submit",
  "targetCoords": null,
  "viewport": { "width": 1920, "height": 1080, "dpr": 2 },
  "commentText": "This button should use our brand green, not purple",
  "author": {
    "id": "...",
    "name": "Alice Dev",
    "email": "alice@acme.com",
    "avatarUrl": "https://..."
  },
  "assets": [
    {
      "id": "3f2a1b7c-...",
      "kind": "screenshot",
      "url": "https://r2.remarks.online/screenshots/...?signature=...",
      "contentType": "image/png"
    }
  ],
  "createdAt": "2026-05-12T14:30:00Z",
  "updatedAt": "2026-05-12T14:30:00Z"
}
```

**POST /uploads/presign**

Request:
```json
{
  "projectId": "...",
  "kind": "screenshot",
  "contentType": "image/png",
  "sizeBytes": 245678
}
```

Response:
```json
{
  "assetId": "3f2a1b7c-...",
  "uploadUrl": "https://...r2.cloudflarestorage.com/...",
  "expiresAt": "2026-05-12T14:45:00Z"
}
```

Flow: extension POSTs to `/uploads/presign` → gets URL → PUTs the image bytes directly to R2 → then POSTs to `/annotations` with the `screenshotAssetId` referencing what was uploaded.

### 5.4 Error response shape

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request body",
    "requestId": "req_...",
    "issues": [
      { "path": ["commentText"], "message": "Required" }
    ]
  }
}
```

`issues` is only present for validation errors. `requestId` is always present.

### 5.5 Pagination

Cursor-based, never offset-based:

```
GET /projects/:projectId/annotations?cursor=eyJ...&limit=50&status=to_do&branch=main
```

Response:
```json
{
  "items": [...],
  "nextCursor": "eyJ..." | null
}
```

## 5.6 Rate limits

Enforced via Upstash Redis with a sliding-window counter. One middleware, applied to every route via a Fastify preHandler hook. Keys are namespaced ratelimit:{bucket}:{identifier} with a TTL equal to the window.
BucketIdentifierLimitWindowmutation (POST/PATCH/PUT/DELETE)user ID10060sread (GET)user ID60060sanon (no auth)IP1060s
Exceeded limit returns 429 with a Retry-After header. Every response (whether limited or not) carries X-RateLimit-Limit and X-RateLimit-Remaining.
Implementation sketch:
```ts
// apps/api/src/lib/redis.ts
import { Redis } from "@upstash/redis";
import { env } from "../env";
export const redis = new Redis({
  url: env.UPSTASH_REDIS_URL,
  token: env.UPSTASH_REDIS_TOKEN,
});
```
```ts
// apps/api/src/plugins/rate-limit.ts
import type { FastifyPluginAsync } from "fastify";
import { redis } from "../lib/redis";
import { RateLimitError } from "@remarks/shared/errors";

const LIMITS = {
  mutation: { limit: 100, windowSec: 60 },
  read:     { limit: 600, windowSec: 60 },
  anon:     { limit: 10,  windowSec: 60 },
} as const;

export const rateLimitPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", async (req, reply) => {
    const authed = req.user != null;
    const mutating = ["POST", "PATCH", "PUT", "DELETE"].includes(req.method);
    const bucket = !authed ? "anon" : mutating ? "mutation" : "read";
    const identifier = authed ? req.user!.id : req.ip;

    const { limit, windowSec } = LIMITS[bucket];
    const key = `ratelimit:${bucket}:${identifier}`;

    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSec);

    reply.header("X-RateLimit-Limit", limit);
    reply.header("X-RateLimit-Remaining", Math.max(0, limit - count));

    if (count > limit) {
      reply.header("Retry-After", windowSec);
      throw new RateLimitError();
    }
  });
};
```
This is the total Redis footprint in Phase 1. No caching, no session store, no queue, no presence tracking. Those are Phase 2+ decisions and require their own ADRs before adding

---

## 6. Extension architecture

### 6.1 Tech

- **WXT** for the build system. Produces MV3 bundles for Chrome and Edge simultaneously.
- **React 19** for UI.
- **Tailwind** for styling. Shadcn components from `packages/ui`.
- **Zustand** for in-extension state.
- **TanStack Query** for server state with optimistic updates and offline mutation queue.
- **Clerk Chrome Extension SDK** for auth.

### 6.2 Entry points

- **Background service worker** (`entrypoints/background.ts`): handles `chrome.tabs.captureVisibleTab`, responds to messages from content script.
- **Content script** (`entrypoints/content.ts`): injected into every page. Runs the Moat sidebar, element picker, rectangle drawer. Posts messages to background for screenshot capture.
- **Popup** (`entrypoints/popup/`): click the icon → small popup with sign-in status, current project, and a "Open Moat" button. Keep it minimal; the real UI is the sidebar injected into the page.

### 6.3 Data flow

```
User clicks element
  → Content script captures { selector, coords, URL, viewport, DOM context }
  → Content script → Background: "capture screenshot"
  → Background: chrome.tabs.captureVisibleTab → cropped PNG
  → Background → Content script: base64 PNG
  → Content script: POST /uploads/presign (via API client)
  → Content script: PUT image to R2 presigned URL
  → Content script: POST /annotations with screenshotAssetId
  → Content script: update sidebar UI (optimistic)
  → Server responds: sidebar reconciles
```

If the network fails at any step after capture, the annotation is queued in IndexedDB and retried when connectivity returns. The sidebar shows a small "Syncing…" badge until all queued items clear.

### 6.4 Sidebar

- Injected into every page, iframe-free (direct DOM injection with strict CSS namespacing).
- All styles prefixed with `.db-` to avoid conflicts with host page.
- Respects host page's `html[data-theme]` and mirrors it if possible; otherwise light theme default.
- Dockable: right (default), left, bottom.
- States: signed out → sign-in prompt; signed in, no project → project picker; signed in with project → thread view.

### 6.5 Element picker

Port from the existing Remarks. Key behaviors:
- `C` to enter pick mode (pointer cursor).
- Hovering highlights elements with a blue outline.
- Click captures the element; comment box opens next to it.
- `Esc` cancels.
- Uses `elementFromPoint` + generated stable selector (prefer `id`, then `data-testid`, then class-based, then nth-child path).

### 6.6 Rectangle picker

Port from existing. Key behaviors:
- `R` to enter draw mode (crosshair cursor).
- Click and drag to draw; release to commit.
- Rectangle coordinates saved in document coordinates (not viewport) so they survive scroll.

### 6.7 Offline queue

Persist annotations in IndexedDB under key `remarks.outbox`. On reconnect or every 30 seconds, flush queue to API. If an individual annotation fails to upload 3 times, mark it `error` in the sidebar and let the user retry manually.

### 6.8 What to drop from current Remarks

- File System Access API usage (no more direct local file writes).
- `html2canvas` (use native capture).
- The entire "moat-watcher" and file-sync workflow (server is the source of truth now).
- Embedded rule templates (replaced by hosted MCP docs).

### 6.9 What to keep

- The visual design language of the sidebar.
- Element picker interaction pattern.
- Rectangle picker interaction pattern.
- Keyboard shortcuts.
- Compact/docked modes.

---

## 7. Dashboard architecture

### 7.1 Tech

- **Next.js 15 App Router** on **Vercel**.
- **Clerk** `@clerk/nextjs` for auth — provides middleware, server helpers, and org-switcher UI.
- **tRPC v11** via `@trpc/next` for all dashboard data fetching.
- **TanStack Query** (tRPC's default).
- **Tailwind + shadcn** from `packages/ui`.
- **PostHog** for analytics, installed via their Next.js integration.

### 7.2 Route structure

```
/                          marketing home (public)
/pricing                   (public)
/docs/*                    redirects to docs.remarks.online
/sign-in                   Clerk-hosted
/sign-up                   Clerk-hosted
/app                       (requires auth) redirects to default project
/app/projects              project list for active org
/app/projects/new          create project
/app/projects/:slug        project detail (annotation thread)
/app/projects/:slug/settings
/app/settings/org          org settings (Clerk org management embedded)
/app/settings/billing      Stripe customer portal (Phase 3)
/app/settings/account      Clerk user profile
```

### 7.3 Server-side data fetching

Everything that's not interactive is fetched in RSC (React Server Components) using the server-side tRPC caller. Client components use the tRPC React hooks for mutations and realtime-adjacent reads.

```ts
// apps/dashboard/src/lib/trpc.ts
import { createTRPCReact } from "@trpc/react-query";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@remarks/api/trpc/router";

export const trpc = createTRPCReact<AppRouter>();

// For RSC:
export const trpcServer = createTRPCProxyClient<AppRouter>({
  links: [httpBatchLink({ url: `${process.env.API_URL}/trpc`, headers: () => ({ /* forward auth */ }) })],
});
```

### 7.4 Realtime updates

Phase 1: **polling**, not WebSockets. Polling every 5 seconds on the annotation thread view is fine for MVP and is much simpler to operate. TanStack Query's `refetchInterval` handles it.

Phase 2+: revisit if users complain. WebSocket adds operational complexity and isn't needed for product-market fit.

### 7.5 Analytics events to capture from day 1

- `org_created`
- `project_created`
- `annotation_created`
- `annotation_status_changed`
- `extension_installed` (via extension pinging dashboard on install)
- `extension_signed_in`

These events feed dashboards in PostHog that tell you retention and activation. Set them up week one.

---

## 8. Infrastructure setup

### 8.0 Service-usage phasing

The list in §8.1 includes accounts to register in Phase 0 so they exist when needed. Not all of them are integrated into code in Phase 1. This table is the authoritative answer for Claude Code when deciding whether a new dependency or import is appropriate.

| **Service** | **Registered** | **Wired into code** | **Purpose in Phase 1** |
| :-------------: | :----------------: | :---------------------: | :-------------------------------------------------------------------------------------------------------------------------------------------------: |
| Clerk | Phase 0 | Phase 1 | Auth for dashboard and extension; handles all auth-related email itself |
| Neon Postgres | Phase 0 | Phase 1 | Primary data store via Drizzle (packages/db) |
| Cloudflare R2 | Phase 0 | Phase 1 | Screenshot blob storage via presigned URLs |
| Cloudflare DNS | Phase 0 | Phase 1 | Domain routing |
| Upstash Redis | Phase 0 | Phase 1 | Rate limiting only (see §5.6). No caching, sessions, or queues in Phase 1. |
| Sentry | Phase 0 | Phase 1 | Error tracking in all four apps |
| PostHog | Phase 0 | Phase 1 | Product analytics + feature flags |
| Fly.io | Phase 0 | Phase 1 | API hosting (and MCP in Phase 2) |
| Vercel | Phase 0 | Phase 1 | Dashboard hosting |
| **Inngest** | **Phase 0** | **Phase 2+** | Not used in Phase 1. First real use is async R2 cleanup on org deletion and MCP webhook fan-out. Do not import the SDK into any app before Phase 2. |
| **Resend** | **Phase 0** | **Phase 2+** | Not used in Phase 1. Clerk sends all auth-related email. First real use is PR notifications (Phase 3). Do not import the SDK before Phase 2. |
| Stripe | Phase 3 | Phase 3 | Billing. Not even registered until Phase 3. |

### 8.1 Accounts to create (Phase 0, week 1)

- [X] GitHub org: `remarks.online`
- [X] Vercel team: `remarks`
- [X] Fly.io org: `remarks`
- [X] Neon account, project: `remarks` with branches `main` (prod), `staging`, `dev`
- [X] Clerk account, apps: `remarks-prod`, `remarks-dev`
- [X] Cloudflare account, R2 buckets: `remarks-screenshots-prod`, `remarks-screenshots-dev`
- [X] Upstash account, Redis DBs: `remarks-prod`, `remarks-dev`
- [ ] Inngest account, apps: `remarks-prod`, `remarks-dev`
- [ ] Resend account with verified domain `remarks.online`
- [X] PostHog account, project: `remarks`
- [ ] Sentry account, projects: one per app (extension, dashboard, api, mcp)
- [ ] Stripe account (Phase 3, not Phase 0)

### 8.2 Domains

- `remarks.online` — primary domain, registered via Cloudflare
- `app.remarks.online` → Vercel (dashboard)
- `api.remarks.online` → Fly (api)
- `mcp.remarks.online` → Fly (mcp, Phase 2)
- `docs.remarks.online` → Vercel or Mintlify (Phase 3)
- `remarks.online` → marketing site, for now just served from the same Vercel project

### 8.3 Fly.io config for API

```toml
# apps/api/fly.toml
app = "remarks-api"
primary_region = "iad"       # or your region

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  PORT = "3000"
  LOG_LEVEL = "info"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "suspend"
  auto_start_machines = true
  min_machines_running = 1
  processes = ["app"]

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 512
```

One machine, suspend-on-idle, scale up as needed. $5/month-ish.

### 8.4 Fly Dockerfile for API

```dockerfile
FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile --filter @remarks/api...

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm turbo build --filter=@remarks/api

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
```

### 8.5 Neon branching strategy

- `main` branch = production
- `staging` branch = forked from main, used by `staging.remarks.online`
- Preview deployments each spin up a new Neon branch from `main`, destroyed on PR merge

Neon's Vercel integration handles the preview-branch lifecycle automatically.

### 8.6 Secret management

- **Local dev**: `.env.local` per app (gitignored)
- **Vercel**: env vars per environment (dev/preview/prod)
- **Fly**: `fly secrets set KEY=value -a remarks-api`
- **GitHub Actions**: repo secrets for deploy credentials

Rotation cadence: Clerk + Stripe API keys quarterly, database URLs as-needed, signing keys only when compromised.

---

## 9. CI/CD and deployment

### 9.1 CI (runs on every PR)

```yaml
# .github/workflows/ci.yml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  check:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: test
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo lint typecheck test
      - run: pnpm turbo test:integration
        env:
          DATABASE_URL: postgres://postgres:test@localhost:5432/test
      - run: pnpm turbo build
```

### 9.2 Deploy: dashboard

Vercel auto-deploys on push to `main` (production) and on PR branches (preview). No workflow needed.

### 9.3 Deploy: API + MCP

```yaml
# .github/workflows/deploy-api.yml
name: Deploy API
on:
  push:
    branches: [main]
    paths:
      - "apps/api/**"
      - "packages/db/**"
      - "packages/shared/**"
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --config apps/api/fly.toml --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

### 9.4 DB migrations

Drizzle generates SQL migrations from schema diffs. They're committed to the repo.

```bash
pnpm --filter @remarks/db db:generate   # generates new migration SQL
pnpm --filter @remarks/db db:migrate    # applies pending to $DATABASE_URL
```

The API, on startup, checks migration status and refuses to start if migrations are pending. Migrations are applied manually (from your laptop against prod) for Phase 1 — automation comes later when you have enough of them to trust the process.

### 9.5 Extension releases

Manual for Phase 1 (Chrome Web Store doesn't support auto-submit easily):

1. Tag a release: `v0.1.0`
2. `release-extension.yml` builds `.zip` for Chrome and Edge, attaches to the GitHub release
3. Manually upload to Chrome Web Store and Edge Add-ons

---

## 10. Testing strategy

### 10.1 Unit tests (Vitest)

- In `packages/*`: aim for 70% line coverage. Pure logic is easy to test.
- In `apps/*`: test services (`apps/api/src/services/*`), not routes. Routes are integration-tested.

### 10.2 Integration tests

- `apps/api/**/*.integration.test.ts`: spin up a Postgres container (Testcontainers), run migrations, test real HTTP endpoints with a real DB.
- Fast enough to run on every PR (< 60s total).

### 10.3 E2E tests

- `apps/dashboard/e2e/`: Playwright against local dev.
- `apps/extension/e2e/`: Playwright launches Chromium with the extension loaded, opens a test page, drives the element picker.

### 10.4 Manual test before every release

A 10-minute smoke-test checklist, run by you, from the user's perspective:
1. Install extension fresh, sign in.
2. Pick element, add comment, verify it appears in dashboard.
3. Draw rectangle, add comment, verify.
4. Sign out and back in.
5. Mark annotation done in dashboard, verify extension reflects.

Automate when you're doing this manually more than once a week.

---

## 11. Observability

### 11.1 Structured logging

- Pino in the API (Fastify default). JSON logs.
- Every log entry includes: `requestId`, `userId` (if auth'd), `orgId`, `projectId` when applicable.
- Logs go to Axiom via Fly's log shipper.

### 11.2 Error tracking

Sentry in every app. Source maps uploaded on build. Release tagging via git SHA.

### 11.3 Metrics

For Phase 1, skip Prometheus-style metrics. Rely on:
- Axiom queries for logs
- Sentry for error rates
- PostHog for product metrics
- Fly's built-in dashboards for system metrics

Add dedicated metrics only when you have a specific question the above can't answer.

### 11.4 Alerting

- Sentry: alert on new error type, or error rate > 10/min
- Fly: alert on machine failing health check, memory > 80%
- All alerts go to your email and your phone. No Slack in Phase 1.

---

## 12. Security baseline

Non-negotiable for Phase 1, even solo:

- **HTTPS everywhere**. No plain HTTP, even in dev (use `mkcert` for local TLS).
- **Clerk handles password hashing, session management, email verification**. You don't touch any of it.
- **CSRF**: not an issue for the API (all requests are CORS-bearer-auth); dashboard uses Clerk session tokens which aren't cookie-based.
- **CORS**: API allows `https://app.remarks.online` and specific extension IDs only.
- **Input validation**: Zod on every request body, enforced at the route handler before the business logic is called. Never trust client input.
- **Output encoding**: React handles it. Don't use `dangerouslySetInnerHTML` on user data, ever.
- **SQL injection**: Drizzle uses parameterized queries. Never concatenate strings into queries.
- **Screenshot URLs**: always presigned, expire in 1 hour. Never publicly accessible.
- **API tokens for MCP**: stored hashed in DB (bcrypt or sha256-hmac). Never logged. Only shown once at creation.
- **Rate limiting**: in Redis, per-user and per-IP.
- **Dependency audit**: `pnpm audit` in CI, fail on critical.
- **Content Security Policy** in the dashboard: strict, no `unsafe-inline` for scripts.
- **Extension manifest permissions**: minimum needed. Document every one in ADR.

---

## 13. Phase 0 task breakdown

Each task is sized to fit in a single Claude Code session. Order matters — later tasks depend on earlier ones.

### Week 1: foundation

| # | Task | Done when |
|---|---|---|
| 0.1 ✓ | Register all hosting accounts from §8.1 | You have dashboards open for each service |
| 0.2 ✓ | Register `remarks.online`, configure Cloudflare DNS | `dig remarks.online` works |
| 0.3 ✓ | Create GitHub monorepo, push empty scaffold with README | Repo visible on GitHub |
| 0.4 ✓ | Add `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `biome.json`, `.nvmrc`, `.gitignore` per §2 | `pnpm install` succeeds |
| 0.5 ✓ | Write `CLAUDE.md` with content from §1 | Claude Code loads it in a fresh session |
| 0.6 ✓ | Write ADR 0001–0013 (one paragraph each is fine for now) | Files exist in `docs/adr/` |
| 0.7 ✓ | Scaffold `packages/shared` with error classes, constants | Package builds and lints clean |
| 0.8 ✓ | Scaffold `packages/db` with Drizzle config pointing at Neon | `pnpm --filter @remarks/db db:push` connects |
| 0.9 ✓ | Implement schemas from §3 in `packages/db` | `drizzle-kit generate` produces migration SQL |
| 0.10 ✓ | Generate initial migration, apply to Neon dev branch | Tables exist in Neon console |

### Week 2: first deploys

| # | Task | Done when |
|---|---|---|
| 0.11 ✓ | Scaffold `apps/api` with Fastify, health endpoint, env validation | `pnpm --filter @remarks/api dev` serves `/health` |
| 0.12 ✓ | Dockerfile for api; `fly launch` to create Fly app | `fly deploy` works, `curl https://api.remarks.online/health` returns 200 |
| 0.13 ✓ | Scaffold `apps/dashboard` with Next.js 15, Clerk middleware, basic pages | `pnpm --filter @remarks/dashboard dev` loads `localhost:3000` with Clerk sign-in |
| 0.14 ✓ | Deploy dashboard to Vercel, configure domain `app.remarks.online` | Dashboard loads at production URL |
| 0.15 ✓ | Scaffold `apps/extension` with WXT, React, Clerk Chrome SDK, basic popup and sidebar | `pnpm --filter @remarks/extension dev` produces loadable extension |
| 0.16 ✓ | Clerk webhook endpoint in API that syncs users/orgs to Postgres | Creating a user in Clerk results in a row in `users` table |
| 0.17 ✓ | `.github/workflows/ci.yml` with lint + typecheck + test + build | Green CI on first PR |
| 0.18 ✓ | `.github/workflows/deploy-api.yml` deploys to Fly on main | Push to main redeploys api |
| 0.19 ✓ | Scaffold `apps/mcp` and `packages/mcp-schema` (empty, not functional) | Packages exist, build clean |
| 0.20 ✓ | Write runbook: "How to set up your dev environment" in `docs/runbooks/setup.md` | Clone → follow doc → `pnpm dev` works |

**Phase 0 exit:** You can sign up on `app.remarks.online`, your user appears in Neon, the extension loads in Chrome, and CI is green. Nothing is functional yet beyond auth, but the entire spine is running.

---

## 14. Phase 1 task breakdown

~16 weeks. Grouped into ~2-week sub-phases.

### Weeks 3–4: annotation storage

| # | Task | Done when |
|---|---|---|
| 1.1 ✓ | Zod schemas in `packages/shared/schemas/annotation.ts`, `project.ts`, `common.ts` from §4 | Types exported, tests pass |
| 1.2 ✓ | API auth middleware: verify Clerk JWT, attach `user` + `orgMemberships` to request | Integration test passes |
| 1.3 ✓ | API authorization helpers: `requireOrgMember`, `requireProjectMember(role)` | Tested with mocked contexts |
| 1.4 ✓ | `POST /orgs/:orgId/projects` endpoint + service | Integration test: create project as admin, 403 as non-member |
| 1.5 ✓ | `GET /orgs/:orgId/projects` + `GET /projects/:id` | Integration tests pass |
| 1.6 ✓ | `R2` client in `apps/api/src/lib/r2.ts` | Can PUT and GET an object in tests |
| 1.7 ✓ | `POST /uploads/presign` endpoint | Integration test uploads a file end-to-end |
| 1.8 ✓ | `POST /projects/:id/annotations` endpoint + service (validates branch exists/creates lazily) | Integration test creates annotation with screenshot reference |
| 1.9 ✓ | `GET /projects/:id/annotations` with cursor pagination + filters | Integration test paginates through 100 seeded annotations |
| 1.10 ✓ | `GET /annotations/:id`, `PATCH`, `DELETE` | All integration tests pass |

### Weeks 5–7: dashboard

| # | Task | Done when |
|---|---|---|
| 1.11 | tRPC setup in api and dashboard, first procedure: `me.getCurrentUser` | Dashboard server component calls it successfully |
| 1.12 | Project list page: `app/(app)/projects/page.tsx` with RSC data fetch | Lists projects for current org |
| 1.13 | Create project flow (modal or page) | Submitting form creates project |
| 1.14 | Project detail page with annotation list grouped by branch | Shows seeded data with screenshots |
| 1.15 | Annotation detail view (right-side drawer or modal) | Shows comment, screenshot, events, status dropdown |
| 1.16 | Status update UI (to_do / doing / done / rejected) | Updates via tRPC mutation with optimistic update |
| 1.17 | Org switcher (Clerk component) | Switching orgs re-fetches projects |
| 1.18 | Polling: annotation list refetches every 5s when tab is visible | Verified manually |
| 1.19 | Empty states for zero projects / zero annotations | Designed and shipped |
| 1.20 | Error boundaries and loading states across the app | No UI crashes on API error |

### Weeks 8–11: extension rewrite

| # | Task | Done when |
|---|---|---|
| 1.21 | Clerk Chrome Extension SDK integrated; sign-in works from popup | Can sign in, see user's orgs |
| 1.22 | Project picker in popup (which project does this tab's annotations go to?) | Selected project persists in `chrome.storage` |
| 1.23 | Port element picker from existing Remarks to React + WXT | Press `C`, click element, see selector |
| 1.24 | Port rectangle picker | Press `R`, draw, commit |
| 1.25 | Port sidebar UI (docking, compact mode) | Visual parity with existing Remarks |
| 1.26 | Native screenshot capture via background service worker | Screenshot appears in sidebar preview |
| 1.27 | Upload flow: presign → PUT → create annotation | Annotation appears in dashboard |
| 1.28 | Offline queue: IndexedDB outbox, retry on reconnect | Kill network, create annotation, restore network, see it sync |
| 1.29 | Sidebar thread view: list of annotations for current URL/branch, with statuses | Threads filter correctly |
| 1.30 | Branch selector in sidebar (free text for Phase 1; GitHub-backed in Phase 3) | User can set branch name and it persists |
| 1.31 | Extension Playwright tests for happy path | Green in CI |

### Weeks 12–14: onboarding + polish

| # | Task | Done when |
|---|---|---|
| 1.32 | Settings page: delete project, rename project | All functional |
| 1.33 | Email invitation flow (Clerk Orgs default UI is fine) | Teammate accepts invite and sees projects |
| 1.34 | Onboarding: first-project wizard with "install extension" CTA | Walks new user through first annotation |
| 1.35 | Marketing home page (static, one page, explains product, CTA to sign up) | Lives at `remarks.online` |

### Weeks 15–18: private beta + iteration

Not task-list-able because it depends on what beta users say. Reserve weeks 15–18 for:
- Bug fixes from the 5–10 design partners using it
- One or two features that two or more partners independently ask for
- Performance pass: screenshot upload speed, sidebar render speed
- Docs site scaffolded (on Mintlify, the simplest option)
- Preparation for Phase 2 (MCP server)

**No new product surface is added in weeks 15–18.** Stabilize what exists.

---

## 15. Exit criteria for Phase 1

Phase 1 is done when all of these are true:

- [ ] A new user can sign up on `app.remarks.online`, create an org, create a project, install the Chrome extension, sign in, annotate a page, and see the annotation in the dashboard. Entire flow under 3 minutes.
- [ ] A teammate can be invited to the org and see the same annotations.
- [ ] Element-picker, rectangle-picker, status update, and delete all work.
- [ ] 5 design partners have used it for at least a week each. 3 of them say unprompted that they'd pay for it.
- [ ] CI green, no known P0 or P1 bugs.
- [ ] Extension submitted (but not necessarily approved) to Chrome Web Store and Edge Add-ons.
- [ ] Observability in place: Sentry errors have < 10/day across all apps, Axiom logs searchable, Fly machines healthy.
- [ ] Weekly active users metric defined in PostHog; you can see it in a dashboard.

When all these are true, Phase 2 (MCP server) spec gets written and Phase 2 begins.

---

## Appendix A: What to hand Claude Code first

For a clean start, set up this order of operations:

1. Create the repo, add this entire doc as `docs/plan/phase-0-1-spec.md`.
2. Create `CLAUDE.md` at the root with the content of §1 plus these two lines at the top:
   ```
   Read `docs/plan/phase-0-1-spec.md` before any substantive work.
   When completing a task from §13 or §14, mark it done with a tick in that file as part of the PR.
   ```
3. Start a Claude Code session with: "Read `CLAUDE.md` and `docs/plan/phase-0-1-spec.md`. Then execute task 0.4 (root-level config files). Open a PR when done."
4. Review the PR carefully — the first few PRs set the conventions that the rest of the project inherits. Don't merge sloppy work just because it passes CI.

Tasks compound. A good Phase 0 makes Phase 1 much faster. A sloppy Phase 0 means you're paying down debt for the next 18 months.
