# Clerk vs. Neon Auth — should we switch mid-Phase-1?

Date: 2026-04-22
Status: Analysis — no decision change; revisit triggers listed

## Context

We have completed tasks 0.x and 1.1–1.2. Task 1.2 (commit `1972d89`) wired a Clerk JWT verification middleware into `apps/api`. ADRs 0003 (Clerk for auth) and 0014 (Clerk → Postgres identity sync) are both Accepted. The question: would Neon's own auth product have been the better call, and is it worth switching now?

Short answer: **no, stay on Clerk.** Neon Auth is a promising product with one genuinely unique feature (branch-aware auth), but as of April 2026 it is still in Beta, organizations are incomplete, and it doesn't fit two of our three surfaces (Fastify API + Chrome extension). Revisit after it reaches GA and ships org JWT claims.

Below is the evidence, then the recommendation, then the trigger that would flip this decision.

---

## What Neon Auth is, today

- Managed wrapper around **Better Auth v1.4.18** (previously Stack Auth; migrated).
- **Status: Beta.** Docs say "Neon Auth is targeting general availability this quarter."
- Auth data lives directly in the user's Neon DB under a `neon_auth` schema (tables: `user`, `account`, `session`, `verification`).
- Tokens: opaque session cookie + JWT access token. Backends verify via JWKS.
- Shipped framework integrations: Next.js, Vite+React, React Router, TanStack Router.
- Shipped plugins: email+password, social OAuth (Google/GitHub/Vercel), email OTP, admin, JWT, OpenAPI, webhooks, trusted domains, branch-aware auth.
- Coming soon: standalone frontend+backend architectures, magic link, phone, MFA, admin plugin customization.
- Organizations: **"partially supported; JWT token claims under development."**
- Constraints: AWS regions only; incompatible with IP Allow / Private Networking.

## What Clerk gives us that we currently rely on

From a repo audit (`apps/api/src/plugins/auth.ts`, `apps/api/src/routes/webhooks/clerk.ts`, `apps/api/src/services/clerk-sync.service.ts`, `apps/dashboard/src/**`, `apps/extension/src/entrypoints/popup/App.tsx`, `packages/db/src/schema/users.ts`, `packages/db/src/schema/organizations.ts`):

1. **Fastify JWT middleware** — `@clerk/backend.verifyToken()` verifies locally; on success we call Clerk API once for `getOrganizationMembershipList`.
2. **Webhook-driven identity sync** — `users.clerkUserId` / `organizations.clerkOrgId` as Clerk FKs; webhook handler + JIT upsert fallback (ADR-0014).
3. **Six Clerk UI components** in the dashboard (`SignIn`, `SignUp`, `OrganizationSwitcher`, `UserButton`, `OrganizationProfile`, `UserProfile`) plus `ClerkProvider` + `clerkMiddleware`.
4. **`@clerk/chrome-extension`** in the extension popup — sign-in from the popup, token handoff to background service worker.
5. **Clerk Orgs** is the source of truth for organizations, invitations, and role management. Tasks 1.17 (org switcher), 1.21 (extension sign-in), and 1.33 (email invitations via Clerk) all bank on Clerk-native UX.

## Where Neon Auth would fit — and where it wouldn't

| Surface | Clerk today | Neon Auth equivalent |
|---|---|---|
| `apps/api` (Fastify) | `@clerk/backend` | **No Fastify integration shipped.** Would DIY JWKS verify — feasible but on us. |
| `apps/dashboard` (Next.js) | `@clerk/nextjs` middleware + 6 components | `@neondatabase/auth/next/server` exists. **No drop-in SignIn / UserButton / OrgSwitcher components** — we'd build our own against Better Auth APIs. |
| `apps/extension` (WXT / Chrome extension) | `@clerk/chrome-extension` | **Not in docs, not on roadmap.** Would need a custom OAuth-popup-to-extension flow. |
| Organizations + invites | Clerk Orgs (complete) | **JWT org claims still under development.** Blocks tasks 1.3 (authz), 1.17 (switcher), 1.33 (invites) as currently specified. |
| Identity sync to our DB | Webhook + JIT (ADR-0014, ~200 LOC) | **Free** — data already in `neon_auth` schema. This is the only ergonomic win. |
| Preview branches | Share one Clerk dev instance, users leak across branches | **Branch-aware auth clones the `neon_auth` schema** with the DB branch. Genuinely unique. |

## Recommendation: stay on Clerk

Reasons, in priority order:

1. **Orgs gap is a hard blocker.** Our data model and half of Phase 1 (1.3 authz helpers, 1.17 switcher, 1.33 invites) depend on first-class organizations with role claims in the JWT. Neon Auth explicitly marks org JWT claims as "under development." Building on an incomplete feature and racing their roadmap is exactly the kind of risk we take on a side project, not a product engagement.
2. **Beta + AWS-only + no SLA.** Clerk is GA with a documented SLA. Moving production auth to a Beta service shifts Remarks' reliability floor to "whatever Neon ships this quarter."
3. **Missing Chrome extension story.** Our extension is a core surface. Clerk ships an official extension SDK; Neon Auth has nothing documented and nothing on the roadmap. This alone is weeks of DIY crypto + message-passing work we don't need.
4. **No Fastify integration.** Minor — we can verify JWKS ourselves — but it means we own more primitive auth code on the hottest code path.
5. **No pre-built UI components.** Clerk's `SignIn` / `OrganizationProfile` / `UserProfile` pages are already wired in. Replacing them with custom Better Auth UI is days of frontend work with no user-facing upside.
6. **Sunk cost is small but not zero.** Task 1.2 is merged. ADRs 0003 and 0014 are written. Switching now also rewrites tasks 1.3–1.33 and invalidates two ADRs.

The one real loss from staying: **branch-aware auth for preview envs.** Clerk dev instances can still be split per-branch manually (dev instance per preview env via CI), just with more plumbing. Not a show-stopper for Phase 1.

## What would change the recommendation

Write this down so future-us has a real trigger, not a vibes check. Revisit the decision when **all** of these are true:

- Neon Auth is GA (not Beta).
- Organizations are fully supported with org roles in JWT claims.
- Either (a) an official `@neondatabase/auth/chrome-extension` SDK ships, or (b) we decide to drop the extension in favor of a web-capture flow.
- We hit a concrete pain point: Clerk bill > $X/month, or a preview-env auth leak incident, or enterprise SSO blocker.

Until then, log it as ADR-candidate "Revisit Neon Auth post-GA" rather than acting.

## Sources

- [Neon Auth overview](https://neon.com/docs/auth/overview)
- [Neon Auth authentication flow](https://neon.com/docs/auth/authentication-flow)
- [Neon Auth branching authentication](https://neon.com/docs/auth/branching-authentication)
- [Neon Auth roadmap](https://neon.com/docs/auth/roadmap)
- Repo: `apps/api/src/plugins/auth.ts`, `apps/api/src/services/clerk-sync.service.ts`, `packages/db/src/schema/{users,organizations}.ts`, `docs/adr/0003-clerk-for-auth.md`, `docs/adr/remarks-adr-0014-clerk-sync.md`, `docs/plan/remarks-phase-0-1-spec.md` §§5, 6, 7, 13–14
