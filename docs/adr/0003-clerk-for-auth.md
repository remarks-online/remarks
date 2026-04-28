# 0003. Clerk for authentication

Date: 2026-04-21
Status: Accepted

## Context

Remarks needs authentication that works across three surfaces (browser extension, Next.js dashboard, Fastify API) and models organizations + memberships on day one — we sell to teams, not individuals, and annotations are always scoped to an org. Building that from scratch (email verification, MFA, OAuth providers, org invites, session rotation) would consume weeks of work and introduce a durable security surface we'd have to own forever.

## Decision

Use **Clerk** as the identity provider for all three surfaces. Clerk provides the Chrome Extension SDK (critical — most auth vendors do not), first-class org/member/role primitives, managed email flows, and JWT-based session tokens the API can verify without a network call. Clerk is the source of truth for *authentication*; Postgres is the source of truth for *authorization* (project-level roles). See ADR-0014 for the precise sync contract between Clerk and our database.

## Consequences

Auth is effectively solved for year 1 and we never touch password hashing, email verification flows, or OAuth redirects. Clerk becomes a hard dependency: if Clerk is down, sign-ins fail. We read the org membership from the JWT on every request instead of mirroring it into Postgres, which keeps the two systems from drifting. Pricing scales with MAU; well within free tier for launch.

## Alternatives considered

**Auth.js (NextAuth)** — strong for Next.js but weak story for a Chrome extension and for a standalone Fastify API; we'd end up writing JWT plumbing ourselves anyway. **Supabase Auth** — couples auth to their Postgres; Neon is our DB of choice (ADR-0004). **Build-our-own with Lucia + Argon2** — correct but a full month of work we'd rather spend on the product. **Auth0 / WorkOS** — comparable to Clerk but more expensive and no extension SDK.

## Amendment — 2026-04-27

The original Context line "annotations are always scoped to an org" was already weakened by migration `0005_personal_annotations` (annotations may have `project_id IS NULL` for personal/URL-keyed captures). Migration `0006_personal_projects` extends the same pattern to *projects*: `projects.org_id` is now nullable and a new `projects.creator_user_id` is always populated. A personal project is creator-owned, has a single `project_members` admin row at create time (the creator), and shows up alongside org projects on `/app/projects` for that user. Slug uniqueness is now scope-aware: `(org_id, slug)` for org projects and `(creator_user_id, slug)` for personal projects, enforced via two partial unique indexes.

Authorization is unchanged in shape — `assertProjectMember` still resolves through `project_members`, which works for both scopes because the creator's admin row is planted on personal-project insert. ADR-0015's token-scope claim ("covers every project the Clerk user is a member of") therefore still holds verbatim. Phase 2 (transferring a personal project into an org) is tracked at https://github.com/remarks-online/remarks/issues/77.

## Amendment — 2026-04-28

Phase 2 of personal projects (issue #77) is implemented: a personal project's creator can transfer it into an organization they hold `org:admin` in. Transfer is **one-way** — the project's `org_id` flips from `NULL` to the target org's id, the creator keeps their `admin` row, and every other current Clerk member of the target org gets an `editor` row in `project_members` (same fan-out shape as `createProject`). Reverse transfer (org → personal) and inter-org transfer are intentionally deferred: both raise non-trivial questions about audit, member-row pruning, and what happens to annotations authored by org-only members, and neither has a clear product driver yet. Slug collisions in the target org reject with a typed `CONFLICT` and the UI prompts the user to rename the project before retrying — auto-renaming on transfer would silently break MCP integrations and bookmarks.
