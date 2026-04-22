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
