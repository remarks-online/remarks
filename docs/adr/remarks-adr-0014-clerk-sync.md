# ADR-0014: Clerk to Postgres identity sync

Date: 2026-04-21
Status: Accepted

## Context

Clerk is the source of truth for authentication (users, organizations, memberships, sessions). Postgres is the source of truth for authorization — which user has what role on which project, and everything else that Clerk doesn't model.

This means we have two identity stores that must stay aligned:

- `clerk.users` ↔ `db.users` (identified by `clerk_user_id`)
- `clerk.organizations` ↔ `db.organizations` (identified by `clerk_org_id`)
- `clerk.organization_memberships` ↔ membership implied by Clerk on each request (we do **not** mirror org membership into our DB — see §Decision)

Two sources of truth for the same concept is a footgun. Mirroring imperfectly leads to confusing bugs: a user deletes their Clerk account, signs up again with the same email, and suddenly has access to projects they shouldn't. A row gets stuck in `doing` because the author's user row got orphaned. The goal of this ADR is to define the sync precisely enough that these bugs don't happen.

This decision affects every request that touches auth, so getting it right once pays back permanently.

## Decision

### 1. What gets mirrored and what doesn't

**Mirrored into Postgres:**
- Users (`clerk_user_id`, `email`, `name`, `avatar_url`)
- Organizations (`clerk_org_id`, `name`, `slug`)

**Not mirrored — read from the Clerk JWT on every request:**
- Org membership and role
- Session state
- Anything else Clerk owns (email verification, MFA, etc.)

The reason we mirror users and orgs is that our schema needs `user_id` and `org_id` foreign keys to link to annotations, projects, etc. The reason we don't mirror org membership is that it changes frequently, it's in the JWT anyway, and mirroring it means every membership change is a failure mode waiting to happen.

### 2. Sync mechanism

**Primary: Clerk webhooks.**

Clerk sends webhooks on user and org lifecycle events. We handle:

| Clerk event | What we do |
|---|---|
| `user.created` | Upsert row in `db.users` |
| `user.updated` | Update matching row (email, name, avatar) |
| `user.deleted` | Hard delete row; cascade handles their annotations (or see §3) |
| `organization.created` | Insert row in `db.organizations` |
| `organization.updated` | Update name/slug |
| `organization.deleted` | Cascade delete (this deletes all projects, annotations, etc. — see §3) |

**Backup: just-in-time upsert on every authenticated request.**

Webhooks fail sometimes — Clerk is down, our API is down, a webhook gets dropped, a test environment wasn't wired up properly. To make this tolerant, every authenticated API request runs a lightweight JIT check:

```ts
// apps/api/src/plugins/auth.ts (sketch)
async function ensureUserSync(clerkUserId: string, clerkUser: ClerkUserClaims) {
  const row = await db.query.users.findFirst({ where: eq(users.clerkUserId, clerkUserId) });
  if (!row) {
    // Webhook was missed — create now
    await db.insert(users).values({
      clerkUserId,
      email: clerkUser.email,
      name: clerkUser.name ?? null,
      avatarUrl: clerkUser.avatarUrl ?? null,
    }).onConflictDoNothing();
    return;
  }
  // Shallow staleness check: only update if something visible differs
  if (row.email !== clerkUser.email || row.name !== clerkUser.name) {
    await db.update(users)
      .set({ email: clerkUser.email, name: clerkUser.name, updatedAt: new Date() })
      .where(eq(users.clerkUserId, clerkUserId));
  }
}
```

This runs on every request inside the auth plugin, but it's idempotent and cheap (one indexed lookup, update only when needed). The webhook is the fast path; JIT is the self-healing backup.

For orgs, JIT runs the first time a user in an org makes an authenticated request: if `db.organizations` doesn't have the org's Clerk ID, we insert it.

### 3. Deletion semantics

This is where two-store systems usually break. We commit to this explicit policy:

**User deletion:**
- Clerk-initiated (user deletes their account in Clerk UI or we get `user.deleted` webhook): we set `db.users.deleted_at` and null out `email`, `name`, `avatarUrl` (soft delete + PII scrub).
- **We do not cascade-delete annotations or events authored by the user**, because that destroys project history. The annotation keeps its `author_id` pointing at the soft-deleted row; the UI shows "Deleted user" as the author name.
- After 30 days, a scheduled job hard-deletes the row (GDPR right-to-be-forgotten compliance). By then, any remaining `author_id` references are set to a singleton "Deleted User" row (UUID hardcoded as `00000000-0000-0000-0000-000000000001`, inserted in migration 0001) to preserve referential integrity.

**Organization deletion:**
- Much more destructive. Org deletion cascades to projects, which cascades to branches, annotations, events, and assets. The cascade is defined in the foreign keys, so this happens automatically.
- Asset cleanup in R2 is async: we publish an `organization.deleting` event to Inngest, which enumerates all `annotation_assets` rows being cascaded and deletes R2 objects in a separate job. This can lag by minutes — that's fine.
- **Before doing any of this, we require Clerk to have emitted `organization.deleted`.** The dashboard "Delete org" UI routes through Clerk, which fires the webhook, which triggers our cascade. We don't have a direct "delete org from our DB" path.

**User removed from org (not deleted):**
- Not mirrored — we read membership from the JWT on every request. If they're no longer in the org per Clerk, they can't authenticate as a member of it, period. Their authored annotations still have their `author_id` pointing at the users table (they still exist as a user, just not a member of that org).

### 4. Webhook handling contract

- Endpoint: `POST /webhooks/clerk`, no auth middleware (signature-verified instead).
- Signature verification via Clerk's Svix signing key, rejecting on any failure.
- Idempotent: every handler re-applies the desired state, no "increment" operations.
- We store the `svix-id` header in a `processed_webhooks` table for 48 hours; duplicate deliveries are acknowledged but not reprocessed.
- 200 response within 5 seconds or Clerk retries. Expensive work (like R2 cleanup on org delete) is published to Inngest and handled async. The webhook handler itself never does heavy lifting.
- On any error after 3 retries, log to Sentry with full payload and move on. The JIT check in §2 is the recovery mechanism.

```ts
// apps/api/src/routes/webhooks/clerk.ts (sketch)
async function handleClerkWebhook(req: FastifyRequest) {
  const verified = verifyClerkSignature(req.headers, req.body);
  if (!verified) throw new UnauthorizedError();

  const event = verified.event;
  const svixId = req.headers["svix-id"] as string;

  const alreadyProcessed = await redis.set(`webhook:clerk:${svixId}`, "1", "NX", "EX", 172800);
  if (alreadyProcessed !== "OK") return { status: "duplicate" };

  switch (event.type) {
    case "user.created":
    case "user.updated":
      await upsertUser(event.data);
      break;
    case "user.deleted":
      await softDeleteUser(event.data.id);
      break;
    case "organization.created":
    case "organization.updated":
      await upsertOrg(event.data);
      break;
    case "organization.deleted":
      await inngest.send({ name: "org.deleted", data: { clerkOrgId: event.data.id } });
      break;
    default:
      // Log unknown event types but don't fail — Clerk adds events over time
      req.log.info({ eventType: event.type }, "Unhandled Clerk webhook type");
  }

  return { status: "ok" };
}
```

### 5. What the API reads from where

Hard rule encoded in the auth plugin:

- **User identity** (id, email) → JWT claims, decorated onto `request.user`
- **Org membership** (which orgs, what role) → JWT claims, decorated onto `request.orgMemberships`
- **Internal user UUID** (`db.users.id`) → looked up once per request via `clerk_user_id`, cached in Redis for 5 minutes
- **Project-level roles** → queried from `db.project_members` on demand
- **Anything in our own tables** → Postgres

Services never call Clerk's API directly from request-handling code. If a service needs something beyond what's in the JWT, it either comes from Postgres or the service is wrong. The only Clerk API calls we make are:
- During webhook verification (handled by Svix library)
- In admin/debug scripts
- Never in the hot path

This rule keeps Clerk from becoming a load-bearing dependency on every request. If Clerk has an outage, our API keeps serving authenticated requests until JWTs expire (15 minutes), and degrades gracefully afterward.

## Consequences

**Positive:**
- One clear contract. Every engineer (and Claude Code session) knows where identity lives.
- Clerk outages don't kill our API for the duration of live JWT validity.
- Webhook failures self-heal via JIT sync — we never need to reconcile manually.
- PII scrub on user deletion makes GDPR compliance a solved problem from day one.
- Annotation history survives user deletion, which is what teams want.

**Negative:**
- Two sources of truth is intrinsically more complex than one. Bugs in the sync logic will exist and need to be debugged.
- The JIT check adds ~5ms to every authenticated request. Negligible but real.
- The "Deleted User" singleton row is ugly and must be hardcoded in a migration. Missing it leads to FK violation on hard delete.
- Webhook deduplication requires Redis; if Redis is down we'd either skip dedup (risk) or reject (availability cost). Phase 1: skip dedup if Redis is unavailable, log the decision, accept the small risk of double-processing an idempotent handler.

**Neutral:**
- We're locked into Clerk as primary identity. Migrating to a different provider later would mean re-establishing this sync with a new source. Not cheap, not impossible.

## Alternatives considered

**1. Mirror everything, including org membership.**
Rejected. Org membership changes frequently (invites, removals, role changes). Mirroring it means every change has a window of inconsistency. Reading from the JWT eliminates the window entirely.

**2. Mirror nothing, store only Clerk IDs as strings.**
Considered seriously. Would eliminate the sync problem. Rejected because:
- Every join needs a lookup to Clerk to get a display name, which is slow and Clerk-rate-limit-risky.
- We'd lose the ability to query "show me all annotations authored by users matching X" without multi-round-trip Clerk lookups.
- The email/name fields we cache are low-churn — it's a good tradeoff.

**3. Use Clerk's "user metadata" for everything, skip Postgres for identity-adjacent data.**
Rejected. Clerk metadata has size limits, no relational queries, no transactions, and no joins. It's for small per-user preferences, not for modeling authorization.

**4. Eventual-consistency sync via Debezium or a CDC tool.**
Overkill. Clerk webhooks are the CDC feed; we don't need another layer.

**5. Lazy-only sync (no webhooks, just JIT).**
Considered. Simpler. Rejected because:
- Org deletion needs webhook-driven cascade (you can't JIT a deletion — by the time a JIT would fire, the user is already gone from Clerk).
- Profile updates (name/email changes) wouldn't propagate until the user next made a request, which is bad UX in the dashboard where teammates see stale names.
- Webhooks are cheap to add and Clerk reliably delivers them.

## References

- Clerk webhooks documentation: `https://clerk.com/docs/integrations/webhooks/overview`
- Svix signature verification: `https://docs.svix.com/receiving/verifying-payloads/how`
- Related ADRs: 0003 (Clerk for auth), 0004 (Neon + Drizzle)

## Revisit when

- We add enterprise SSO (SAML). Clerk handles it, but the sync semantics might need review.
- We hit Clerk API rate limits during webhook bursts. We haven't yet; they're generous.
- We add a second identity provider (e.g., for self-hosted enterprise). This ADR assumes exactly one.
- User count crosses ~10,000 and the JIT sync latency becomes measurable.
