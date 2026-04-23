# Remarks: Phase 3 Implementation Spec

This document is the executable spec for Phase 3. Same pattern as Phase 0/1 and Phase 2: hand to Claude Code session-by-session.

**Scope of this doc:**
- GitHub App: install, webhooks, PR linking, real `remarks_open_pr`
- Notifications: email (via Resend) + in-app inbox
- Billing: Free + Team tier via Stripe
- Public launch: marketing site, docs site, launch comms

**Prerequisite:** Phase 2 is complete per its exit criteria. MCP server is live, Skill is distributed, agents can process tasks end-to-end. Private beta customers are actively using it.

**Estimated effort:** ~14–18 weeks for a solo developer with Claude Code. This is the biggest phase by far. Plan accordingly.

---

## Table of contents

1. [Product goals for Phase 3](#1-product-goals-for-phase-3)
2. [The sub-phases and their sequencing](#2-the-sub-phases-and-their-sequencing)
3. [GitHub integration](#3-github-integration)
4. [Notifications](#4-notifications)
5. [Billing](#5-billing)
6. [Marketing and docs sites](#6-marketing-and-docs-sites)
7. [Launch](#7-launch)
8. [Data model amendments](#8-data-model-amendments)
9. [Infrastructure additions](#9-infrastructure-additions)
10. [Observability additions](#10-observability-additions)
11. [Security and compliance gates](#11-security-and-compliance-gates)
12. [Task breakdown](#12-task-breakdown)
13. [Exit criteria for Phase 3](#13-exit-criteria-for-phase-3)
14. [Appendix A: things explicitly deferred to year 2](#appendix-a-things-explicitly-deferred-to-year-2)

---

## 1. Product goals for Phase 3

Phase 3 turns Remarks from "a working product with private beta users" into "a monetized public product." Three things get true at the end of Phase 3:

1. **The loop closes through git.** A comment in the browser becomes a PR on GitHub, reviewable like any other PR, with status that flows back into Remarks.
2. **People know when something happened.** Annotations they care about surface via email and an in-app inbox without needing to check the dashboard.
3. **People can pay.** Team tier billing is live; free tier has meaningful limits; someone can put a credit card down and immediately get upgraded.

The success test at end of Phase 3: a stranger on the internet can sign up, install the extension, create a project, connect their GitHub repo, connect their coding agent, file an annotation, watch their agent fix it and open a PR, merge the PR, and receive an email when the loop closes. Then they can click an "Upgrade" button and go from free to Team tier with a corporate credit card, without talking to anyone.

Explicit non-goals for Phase 3:
- Business tier (Figma sync, policies, drift detection — all year 2)
- Self-hosted / on-prem
- SOC 2 audit (process can start, audit itself is year 2)
- GitLab, Bitbucket, Azure DevOps (GitHub only)
- Slack notifications (email + in-app only; Slack is year 2)
- VS Code extension, Safari extension, desktop app

---

## 2. The sub-phases and their sequencing

Phase 3 has four sub-phases. They must run in this order because each depends on the previous.

| Sub-phase | Weeks | What it delivers |
|---|---|---|
| 3A: GitHub integration | 1–6 | GitHub App installed, PRs linked to annotations, real `remarks_open_pr` |
| 3B: Notifications | 7–9 | Email via Resend + in-app inbox with unread state |
| 3C: Billing | 10–13 | Free tier enforced, Team tier self-serve via Stripe |
| 3D: Marketing + launch | 14–18 | Marketing site, docs site, public launch |

**Critical dependency: sub-phase 3C depends on sub-phase 3B** because billing emails (receipts, payment failures, trial expiry) go through the same email infrastructure. Don't try to parallelize these.

**Sub-phase 3D can start partway through 3C**, because marketing copy and docs can be drafted while billing is still being built. But 3D doesn't *complete* until everything else is done and tested.

Each sub-phase has its own sub-exit-criteria; don't start the next one until the previous is green.

---

## 3. GitHub integration

### 3.1 Why it's first

GitHub integration is the single biggest unlock. Without it, Remarks is a notes tool that happens to talk to coding agents. With it, Remarks is the feedback layer for shipping software. Every other Phase 3 piece (notifications are mostly *about* PRs; billing exists to monetize people who get value from the closed loop) depends on the loop existing.

### 3.2 GitHub App, not OAuth

Two integration patterns exist. GitHub Apps are the right choice here.

- **GitHub App**: installed per-organization by an org admin, has its own identity, fine-grained permissions, can act autonomously via webhooks, rate limits are per-installation. This is how Vercel, Linear, Cursor, Sentry all integrate.
- **OAuth App**: authenticates as a user, acts on their behalf, limited by their permissions. Simpler to build, worse to operate.

We use a GitHub App. Specifically: one App called "Remarks" with installation-scoped permissions. Users install the App on their org (or their personal account); Remarks gets webhook events and can act via the installation's access token.

### 3.3 Permissions the GitHub App needs

Minimum viable set:

| Permission | Level | Why |
|---|---|---|
| Contents | Read & write | Read repo structure; write branches and commits (for the agent's PRs) |
| Pull requests | Read & write | Open PRs, comment on PRs, update PR status |
| Issues | Read & write | Optional: cross-link annotations to issues |
| Metadata | Read | Required for basic App function |
| Checks | Read & write | So Remarks can set PR status checks ("3 annotations resolved") |
| Members | Read | Resolve GitHub usernames to Remarks users |

Webhook events to subscribe to:
- `pull_request` (opened, closed, merged, reopened)
- `pull_request_review` (submitted)
- `push` (to detect branch updates)
- `installation` (to handle install/uninstall/permission changes)
- `repository` (to catch repo renames and deletions)

### 3.4 Installation and project-to-repo linking

Flow:

1. User in the Remarks dashboard clicks "Connect GitHub" on a project's settings page.
2. Redirected to `https://github.com/apps/remarks/installations/new?state={projectId}`.
3. User picks which org/account to install on, which repos to grant access to.
4. GitHub redirects back to `app.remarks.dev/integrations/github/callback?installation_id=X&state={projectId}`.
5. We record the installation in `github_installations` table and link the project to one specific repo (user picks from the granted list).
6. Webhook starts firing; we process events.

Multiple Remarks projects can reference the same GitHub repo (e.g., staging and prod instances of the same codebase). One GitHub installation can serve many projects.

### 3.5 Schema

See §8 for the full schema additions. The important new tables:

- `github_installations` — one row per GitHub installation (org-level)
- `github_repos` — repos the installation has granted access to
- `project_github_links` — which project is linked to which repo
- `pull_requests` — PRs we know about (created by us or observed via webhook)
- `annotation_pr_links` — many-to-many: annotations ↔ PRs

### 3.6 Real `remarks_open_pr`

The Phase 2 stub returns `pending_github_integration`. Phase 3 replaces it with the real thing.

When an agent calls `remarks_open_pr(project_id, task_ids, branch, title, description)`:

1. Look up the project's GitHub link. If no link, return the same `pending_github_integration` as before, but with a message telling the user to connect GitHub.
2. Check that the branch exists on GitHub (if not, the agent hasn't pushed yet — return a friendly error).
3. Open a draft PR via the GitHub API, using the installation's token.
4. PR description is a template: the agent's `description` + a footer listing each annotation with a link back to `app.remarks.dev/app/annotations/{id}`.
5. Store in `pull_requests` + `annotation_pr_links`.
6. Return `{ status: "opened", pr_url, pr_number }`.

The agent typically calls this *after* committing to the branch. The PR is a draft, so nothing merges until a human marks it ready.

### 3.7 Handling webhook events

Each event type has a specific handler. Handlers are thin — they update state and publish to Inngest for any fan-out (email notifications, etc.).

| Event | What we do |
|---|---|
| `pull_request.opened` | If it references a Remarks annotation in the body (via our URL convention), link them. If not, record the PR but don't link. |
| `pull_request.closed` (merged=true) | Mark all linked annotations as `done` if they were `doing`. Publish `pr.merged` Inngest event for notifications. |
| `pull_request.closed` (merged=false) | If linked annotations are `doing`, revert them to `to_do`. Publish `pr.closed_without_merge` event. |
| `pull_request.reopened` | Move linked annotations from `to_do` back to `doing` if applicable. |
| `pull_request_review.submitted` | Publish `pr.reviewed` event for notifications (review-requested author gets pinged). |
| `push` | Update `branches.git_sha` for the matching branch. |
| `installation.created` | Record installation, no project linking yet (that's a separate user action). |
| `installation.deleted` | Mark installation and all dependent repos/links as removed; do not hard-delete historic PR data. |

### 3.8 Detecting "this PR references a Remarks annotation"

Two mechanisms, belt and suspenders:

1. **Agent-created PRs**: the PR body has a well-known footer we insert: `<!-- remarks:annotation-ids=a,b,c -->`. We parse this on `pull_request.opened`.
2. **Human-created PRs**: users can paste annotation URLs (`https://app.remarks.dev/app/annotations/{id}`) in the PR body. We scan for these.

Both are idempotent; if the same PR gets both, we dedupe.

### 3.9 Status checks on PRs

When a PR is linked to annotations, we set a status check on it:

- `remarks/annotations`: `pending` while any linked annotation is `to_do` or `doing`, `success` when all are `done`, `failure` if any are `rejected`.

This lets teams (optionally, via branch protection rules) require that all referenced annotations are resolved before merge. Opt-in; Remarks doesn't configure branch protection itself.

### 3.10 Rate limits on the GitHub side

GitHub's per-installation rate limit is 5,000 requests/hour per app installation. We'll never hit it in Phase 3, but:

- We cache the installation access token for 50 minutes (GitHub tokens expire at 60).
- We batch GitHub API calls where possible.
- If we do hit a rate limit, we back off and retry via Inngest.

### 3.11 Security considerations specific to the App

- **Webhook signature verification**: GitHub signs webhooks with a secret we set. We verify every payload; reject on mismatch.
- **Private key for App auth**: stored in Fly secrets, never logged.
- **Per-installation token minting**: tokens are minted on-demand (via JWT signed with the App's private key), cached in Redis, never written to Postgres.
- **Repo access is least-privilege**: we request only the repos the user explicitly granted. We never enumerate or access others.

### 3.12 What about pushes to GitHub from Remarks?

A subtle thing: the agent writes code in the user's local checkout and pushes via the user's own git credentials. Remarks does not push code on behalf of users. This is intentional:

- The agent already has the user's git credentials (they're running it locally).
- Having Remarks push means we need commit signing, branch permissions, and a lot of trust we haven't earned.
- It also means every commit authored by the agent is still attributable to the user, which is what teams want.

So Remarks only *opens PRs* via the GitHub App (which requires a branch to already exist on origin). The agent is responsible for pushing the branch before calling `remarks_open_pr`. If the branch isn't there when `remarks_open_pr` is called, we return a clear error.

This is worth an ADR (ADR-0015: "We open PRs but do not push commits").

---

## 4. Notifications

### 4.1 Scope

Two channels at launch: **email** (via Resend) and **in-app inbox** (a new surface in the Remarks dashboard).

Out of scope: Slack (year 2), desktop push, SMS, webhooks out to third parties.

### 4.2 Events that trigger notifications

Every notification is driven by one of these events, published to Inngest:

| Event | Who gets notified | Default channel(s) |
|---|---|---|
| `annotation.created` | Project admins (not author), mentioned users | In-app |
| `annotation.assigned` | Assignee | In-app + email |
| `annotation.status_changed` (to `done` or `rejected`) | Author, assignee | In-app |
| `annotation.comment_added` (by another user or agent) | Participants in thread | In-app |
| `pr.opened` (by an agent) | Project editors | In-app |
| `pr.merged` | Annotation author, assignee | In-app + email |
| `pr.closed_without_merge` | Annotation author, assignee | In-app + email |
| `project.member_added` | The newly added user | Email (Clerk handles invite email; we send "welcome to project" separately) |
| `billing.payment_failed` | Org owner | Email (critical) |
| `billing.trial_ending` | Org owner | Email |

### 4.3 Preferences

Users control notifications at the user level, not the org level:

- Per-event-type toggles for email (defaults above).
- All in-app notifications are always on (you can still mark them read/archive them).
- Daily digest option: one email per day summarizing activity instead of per-event.
- Global "do not disturb" toggle with optional schedule.

Default state for new users: email on for everything marked "email" above, in-app on for everything.

### 4.4 In-app inbox

A new surface in the dashboard:

- Bell icon in the app header with unread count badge.
- Click opens a popover with the last 20 notifications, each linking to the relevant annotation/PR/etc.
- "View all" link opens a full inbox page with filtering (all / unread / mentions / archived) and search.
- Mark-read on click, archive on swipe (or explicit action).
- Unread count is aggressively cached (Redis key per user, 30s TTL, invalidated on any new notification).

### 4.5 Email delivery

Email via Resend. One sender domain: `notifications@remarks.dev`.

- All email has both an HTML and a plaintext version.
- Templates live in `packages/shared/src/email-templates/` as React Email components (typed, previewable).
- One click "Unsubscribe from these" link per email, always honored.
- Transactional emails (billing, security) cannot be unsubscribed from; these are clearly labeled.

### 4.6 Fan-out architecture

Event → Inngest → per-recipient notification records → delivery

```
┌──────────────────┐
│  Event published │
│  to Inngest      │
│  (annotation.    │
│   created, etc.) │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────┐
│ Inngest function:                    │
│ fanout_notifications                 │
│                                      │
│ 1. Load recipients (DB query)        │
│ 2. For each recipient:               │
│    a. Check their preferences        │
│    b. Write notifications row (DB)   │
│    c. If email: enqueue send_email   │
│    d. If in-app: increment unread    │
│       count in Redis                 │
└──────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────┐
│ Inngest function:                    │
│ send_email                           │
│                                      │
│ 1. Render template                   │
│ 2. Call Resend API                   │
│ 3. Update notifications row with     │
│    delivery status                   │
│ 4. Retry with backoff on failure     │
└──────────────────────────────────────┘
```

Two Inngest functions, retries handled automatically by Inngest. If Resend is down, emails queue and retry for up to 24 hours.

### 4.7 Daily digest

For users who prefer digests:

- Scheduled Inngest function at 8 AM in each user's timezone.
- Reads their pending undelivered notifications from the last 24h.
- Renders a single email summarizing them, sends via Resend, marks as delivered.
- If no activity, no email (no empty digests).

---

## 5. Billing

### 5.1 Plans

Two plans in Phase 3. Business tier is a "contact us" link only; deferred to year 2.

| Plan | Price | Limits |
|---|---|---|
| Free | $0 | 1 project per org, 3 users per org, 500 MB screenshot storage, 30-day annotation retention |
| Team | $20/editor/month | Unlimited projects, unlimited users, 50 GB storage per org, unlimited retention |

"Editor" = a user with role `editor` or `admin` on at least one project. Viewers are free.

### 5.2 Enforcement

Limits are enforced server-side, with friendly errors, never silently:

- **Project count (Free)**: POST /projects returns 402 (`PLAN_LIMIT`) when the 2nd project is attempted, with a message and an upgrade link.
- **User count (Free)**: invitation fails with 402 when the 4th user is invited.
- **Storage (both plans)**: when storage crosses 90% of the plan limit, warn in dashboard banner. At 100%, new screenshot uploads fail with 402.
- **Retention (Free only)**: a scheduled Inngest job hard-deletes annotations and their assets older than 30 days on free plans. Users are warned 7 days in advance via email.

### 5.3 Stripe integration

Using Stripe Billing + Stripe Checkout + Stripe Customer Portal. We do not build any billing UI ourselves beyond the "Upgrade" button that redirects to Checkout.

Product/price setup (do this in the Stripe dashboard, not code):

- Product: "Remarks Team"
- Price: $20 USD per editor per month, recurring, per-seat metered
- Optional: 14-day free trial

### 5.4 Checkout flow

1. User clicks "Upgrade to Team" in the dashboard.
2. Server calls `stripe.checkout.sessions.create` with the org's customer ID (created on org creation or lazily here), the price ID, the current editor count as quantity, and a success/cancel URL.
3. User is redirected to Stripe Checkout (hosted).
4. On success, redirected to `app.remarks.dev/app/settings/billing?success=true`.
5. Webhook `checkout.session.completed` fires; we flip `organizations.plan` to `team` and record subscription ID.
6. User sees their new plan; previous limits no longer apply.

### 5.5 Seat quantity management

Stripe tracks the seat quantity. When an editor is added/removed from the org (via Clerk), we recalculate editor count and call `stripe.subscriptions.update` with the new quantity. Proration handled by Stripe.

This is subtle: the definition of "editor" is Remarks', not Clerk's. A user might be a Clerk org member but only a viewer on all projects — they don't count as an editor for billing. So the sync runs on: (a) Clerk webhook when org membership changes, (b) our own webhook when project role changes.

### 5.6 Customer portal

The "Manage billing" link in dashboard settings opens the Stripe-hosted Customer Portal. Users can update payment method, download invoices, cancel, change plans. We don't build any of this ourselves.

### 5.7 Failed payments and dunning

Stripe handles dunning (retry logic, emails). We handle:

- `invoice.payment_failed` webhook → in-app banner + email to org owner
- `customer.subscription.deleted` webhook → revert org to free tier; enforce free limits on next request; give 7-day grace period on data above free limits before deletion

### 5.8 Free trials

14-day free trial on Team, no credit card required upfront. Handled via Stripe subscription trial.

- User clicks "Start free trial" → Stripe Checkout with trial terms
- At day 12: email "your trial ends in 2 days"
- At day 14: trial ends; if payment method on file, subscription starts; if not, reverts to free

### 5.9 Edge cases worth planning for

- **User downgrades mid-cycle**: keep Team features until end of paid period, then enforce free limits.
- **Org hits free limit mid-cycle**: can't happen (Team has no meaningful limits at our scale), but if Stripe payment fails, free limits snap back.
- **Seat count decreases**: if they had 5 editors and now have 3, Stripe prorates a credit. Automatic.
- **Customer deletes Remarks org**: cancel subscription immediately, delete DB records after 30 days.

### 5.10 Tax

Stripe Tax enabled globally. It handles VAT, GST, US sales tax automatically based on the customer's billing address. No additional code on our side.

---

## 6. Marketing and docs sites

### 6.1 Marketing site

`remarks.dev` (root). Simple static site served from the same Vercel project as the dashboard (different routes in the Next.js App Router).

Pages at launch:
- Home: hero, three-step "how it works" demo video, social proof (beta user logos if permitted), CTA
- Pricing: free vs Team, with clear feature comparison and FAQ
- For Designers / For Developers / For PMs: three persona pages (can ship as one page if time is tight)
- Changelog: auto-generated from release notes
- Blog: optional, start with 2–3 launch posts
- Legal: Privacy, Terms, DPA (hosted from a templated static source; use a lawyer once)
- About: short, 1 page, who's behind it (just you)

Content is MDX files in the dashboard repo, not a separate CMS. Adding a blog post = writing a file, pushing to main, done.

### 6.2 Docs site

`docs.remarks.dev`. Two options:

1. **Mintlify** — SaaS docs tool, great DX, $150/mo when traffic grows. Recommended.
2. **Nextra** — open-source Next.js docs framework. Free, more work to maintain.

For a solo founder, Mintlify pays for itself in time saved. Pick Mintlify, revisit at $500 MRR.

Docs structure:
- **Getting started**: install extension, create project, make first annotation, connect agent.
- **Agent setup**: one page per supported agent (Claude Code, Cursor, Windsurf, Codex, Copilot, Generic MCP). Each page is the install snippet + troubleshooting.
- **MCP reference**: auto-generated from `packages/mcp-schema` (write a build script).
- **API reference**: auto-generated from Zod schemas in `packages/shared`.
- **Concepts**: what an annotation is, how branches work, how status flows.
- **Integrations**: GitHub App install, Slack (year 2 placeholder).
- **Troubleshooting**: common issues.
- **Changelog**: same source as marketing site.

### 6.3 Demo video

Non-negotiable for launch: a 60-second demo video showing the full loop (annotate → agent processes → PR opens → merge → annotation closes). Record it yourself. Don't hire a production company.

Tools: Screen Studio (Mac) or Loom + some editing. Host on YouTube, embed on home page.

---

## 7. Launch

### 7.1 Definition

"Launch" means: `remarks.dev` is publicly accessible, anyone can sign up, billing works, docs are complete, support channel exists, and there's at least one coordinated moment of announcement.

### 7.2 Pre-launch checklist (week 16–17)

| | |
|---|---|
| [ ] All Phase 3 features live in production and tested end-to-end | |
| [ ] At least 5 private beta users have converted to paid Team tier | |
| [ ] Marketing site live at `remarks.dev` | |
| [ ] Docs site live at `docs.remarks.dev` with all Getting Started pages | |
| [ ] Extension published to Chrome Web Store (approval takes 1–2 weeks; submit early) | |
| [ ] Extension published to Edge Add-ons | |
| [ ] Demo video recorded and embedded | |
| [ ] Privacy policy, Terms of Service, DPA reviewed by a lawyer | |
| [ ] Support email (`support@remarks.dev`) forwards to your inbox | |
| [ ] Status page (`status.remarks.dev`) — use Statuspage.io free tier or BetterStack | |
| [ ] Post-launch runbook (what to do if things break) | |
| [ ] Sentry error rate is < 0.1% across all apps for the past 7 days | |
| [ ] Fly and Vercel cost projections understood for 10x traffic | |

### 7.3 Launch week (week 18)

Monday: post on Twitter/X, personal LinkedIn, and whatever dev communities you're in (Reddit r/webdev if it's a good fit, specific Discord servers).

Tuesday: Hacker News "Show HN" post. Time it for 7–9 AM PST for best traction. Write a thoughtful post explaining *why*, not just *what*. Stay in the comments for 12 hours answering every question.

Wednesday: Product Hunt launch. Line up a hunter in advance (ideally not you, someone with existing followers on PH).

Thursday: follow-up posts responding to feedback, thank-yous, first user stories.

Friday: email every beta user and mailing list subscriber with the official announcement and any launch-week discount.

### 7.4 What can go wrong

Plan for these:

- **HN front page**: traffic can 100x for 24 hours. Verify Fly can autoscale, Neon has capacity, Vercel is on a plan that handles bandwidth. Budget $200 for one-day overages just in case.
- **Someone finds a security bug**: have a `security@remarks.dev` address on the site, monitored. Respond within hours.
- **A competitor preempts you**: possible; not controllable. Launch anyway.
- **An integration silently breaks**: a monitoring check that hits each critical path every 5 minutes (a "golden transaction" Playwright test running on a cron) catches this.

### 7.5 Post-launch

Don't disappear after Friday. For the first 30 days post-launch:

- Respond to every support email within 24 hours (ideally 4)
- Ship a fix for any reported bug within 48 hours
- Talk to at least 3 new paying customers per week (phone/video, 20 minutes each)
- Weekly blog post or changelog entry to show momentum

---

## 8. Data model amendments

### 8.1 GitHub integration tables

```ts
// packages/db/src/schema/github-installations.ts
import { pgTable, text, timestamp, uuid, bigint, jsonb, index } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const githubInstallations = pgTable(
  "github_installations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    githubInstallationId: bigint("github_installation_id", { mode: "number" }).notNull().unique(),
    githubAccountId: bigint("github_account_id", { mode: "number" }).notNull(),
    githubAccountLogin: text("github_account_login").notNull(),
    githubAccountType: text("github_account_type").notNull(),   // "User" | "Organization"
    installedById: uuid("installed_by_id").notNull(),            // FK to users
    permissionsGranted: jsonb("permissions_granted").$type<Record<string, string>>().notNull(),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    uninstalledAt: timestamp("uninstalled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("github_installations_org_idx").on(t.orgId),
  }),
);
```

```ts
// packages/db/src/schema/github-repos.ts
export const githubRepos = pgTable(
  "github_repos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    installationId: uuid("installation_id").notNull().references(() => githubInstallations.id, { onDelete: "cascade" }),
    githubRepoId: bigint("github_repo_id", { mode: "number" }).notNull().unique(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    defaultBranch: text("default_branch").notNull(),
    private: boolean("private").notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);
```

```ts
// packages/db/src/schema/project-github-links.ts
export const projectGithubLinks = pgTable(
  "project_github_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }).unique(),
    githubRepoId: uuid("github_repo_id").notNull().references(() => githubRepos.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);
```

(One project links to one repo; enforced by the unique on `projectId`. Multiple projects can link to the same repo via separate rows.)

### 8.2 Pull request tables

```ts
// packages/db/src/schema/pull-requests.ts
export const prStatusEnum = pgEnum("pr_status", ["open", "merged", "closed"]);

export const pullRequests = pgTable(
  "pull_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    githubRepoId: uuid("github_repo_id").notNull().references(() => githubRepos.id),
    githubPrNumber: integer("github_pr_number").notNull(),
    title: text("title").notNull(),
    status: prStatusEnum("status").notNull().default("open"),
    draft: boolean("draft").notNull().default(false),
    url: text("url").notNull(),
    openedById: uuid("opened_by_id").references(() => users.id),   // null if opened via agent token
    openedByTokenId: uuid("opened_by_token_id").references(() => projectApiTokens.id),
    branchName: text("branch_name").notNull(),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    repoNumberIdx: uniqueIndex("pull_requests_repo_number_idx").on(t.githubRepoId, t.githubPrNumber),
  }),
);
```

```ts
// packages/db/src/schema/annotation-pr-links.ts
export const annotationPrLinks = pgTable(
  "annotation_pr_links",
  {
    annotationId: uuid("annotation_id").notNull().references(() => annotations.id, { onDelete: "cascade" }),
    pullRequestId: uuid("pull_request_id").notNull().references(() => pullRequests.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.annotationId, t.pullRequestId] }),
  }),
);
```

### 8.3 Notification tables

```ts
// packages/db/src/schema/notifications.ts
export const notificationChannelEnum = pgEnum("notification_channel", ["in_app", "email"]);
export const notificationStatusEnum = pgEnum("notification_status", ["pending", "delivered", "failed", "skipped"]);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),                     // "annotation.created", "pr.merged", etc.
    channel: notificationChannelEnum("channel").notNull(),
    status: notificationStatusEnum("status").notNull().default("pending"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    linkUrl: text("link_url"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),  // context for rendering
    readAt: timestamp("read_at", { withTimezone: true }),        // in_app only
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    failedReason: text("failed_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userUnreadIdx: index("notifications_user_unread_idx").on(t.userId).where(sql`${t.readAt} IS NULL AND ${t.archivedAt} IS NULL`),
    userCreatedIdx: index("notifications_user_created_idx").on(t.userId, t.createdAt),
  }),
);
```

```ts
// packages/db/src/schema/notification-preferences.ts
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    emailDigestMode: text("email_digest_mode").notNull().default("instant"),   // "instant" | "daily" | "off"
    emailPreferences: jsonb("email_preferences").$type<Record<string, boolean>>().notNull().default({}),
    quietHoursStart: integer("quiet_hours_start"),               // 0-23 (UTC offset applied at render time)
    quietHoursEnd: integer("quiet_hours_end"),
    timezone: text("timezone").default("UTC"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);
```

### 8.4 Billing tables

Most billing state lives in Stripe. We mirror just enough to do server-side authorization without calling Stripe on every request.

```ts
// Add to organizations table (already has stripe_customer_id from Phase 1):
stripeSubscriptionId: text("stripe_subscription_id"),
subscriptionStatus: text("subscription_status"),              // mirror of Stripe status
subscriptionCurrentPeriodEnd: timestamp("subscription_current_period_end", { withTimezone: true }),
seatCount: integer("seat_count").notNull().default(0),        // editors counted at last reconciliation
seatCountUpdatedAt: timestamp("seat_count_updated_at", { withTimezone: true }),
```

(This is an ALTER TABLE on the existing `organizations`, not a new table.)

```ts
// packages/db/src/schema/plan-usage.ts
export const planUsage = pgTable(
  "plan_usage",
  {
    orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
    projectCount: integer("project_count").notNull().default(0),
    editorCount: integer("editor_count").notNull().default(0),
    storageBytesUsed: bigint("storage_bytes_used", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);
```

Updated by Inngest on a 5-minute schedule; used by limit-checking middleware.

### 8.5 Migration strategy

These schema changes land across multiple Phase 3 tasks, not in one big migration:

- 3A tasks add the GitHub and PR tables
- 3B tasks add the notification tables
- 3C tasks add the billing columns

Each task is one migration. Don't try to consolidate; small migrations are safer.

---

## 9. Infrastructure additions

### 9.1 Newly wired-in services

| Service | Wired for | Notes |
|---|---|---|
| **Inngest** | 3A (for GitHub webhook fan-out), 3B (notification delivery), 3C (scheduled usage reconciliation, trial expiry) | First real use across the board; the Phase 2 task 2.30 was the trial run |
| **Resend** | 3B | Transactional email. Verify `remarks.dev` domain for sending. |
| **Stripe** | 3C | New account, configure products/prices in the dashboard, set up webhook endpoint |

### 9.2 New domains

| Domain | Hosting | Purpose |
|---|---|---|
| `docs.remarks.dev` | Mintlify (SaaS) | Docs site |
| `status.remarks.dev` | Statuspage.io or BetterStack | Public status |

`app.remarks.dev`, `api.remarks.dev`, `mcp.remarks.dev` are all existing from prior phases.

### 9.3 New webhooks endpoints

On `apps/api`:

- `POST /webhooks/github` — signature-verified via GitHub's HMAC; enqueues events to Inngest
- `POST /webhooks/stripe` — signature-verified via Stripe's signing secret; handles subscription lifecycle

Both follow the same pattern as the existing Clerk webhook: verify signature, enqueue to Inngest for async handling, return 200 within 5 seconds.

### 9.4 Inngest app setup

Single Inngest app (same as from Phase 2's task 2.30). Phase 3 adds ~10 functions, all in `apps/api/src/inngest/functions/`:

- `fanout_notifications`
- `send_email`
- `daily_digest`
- `github_process_webhook`
- `github_sync_installation_repos`
- `stripe_process_webhook`
- `reconcile_org_usage` (scheduled, every 5 min)
- `trial_expiry_warning` (scheduled, daily at 8 UTC)
- `free_tier_retention_sweep` (scheduled, daily at 2 UTC)
- `asset_cleanup` (exists from 2.30)

Each function has its own file, colocated tests.

### 9.5 Cost projections for Phase 3

Rough monthly operating cost at 100 paying teams (average 5 editors = 500 billed seats × $20 = $10k MRR):

| Service | Cost |
|---|---|
| Fly.io (3 apps × 1 small machine + scaling headroom) | $40 |
| Vercel (Pro plan for team features + bandwidth) | $20 |
| Neon (Pro for autoscaling + branching) | $40 |
| Cloudflare R2 (~800 GB storage + minimal egress) | $15 |
| Upstash Redis | $10 |
| Inngest (free tier likely covers; Pro if needed) | $0–40 |
| Resend (startup plan) | $20 |
| Sentry (team plan) | $26 |
| PostHog (growth tier based on usage) | $0–50 |
| Clerk (production plan, based on MAU) | $25+ |
| Mintlify | $150 |
| Stripe (3% of GMV after free tier) | ~$300 |
| Statuspage | $30 |
| **Total** | **~$750** |

Gross margin on $10k MRR: ~92%. Healthy. Monitor and optimize as you grow.

---

## 10. Observability additions

### 10.1 New dashboards

In addition to Phase 1 and 2 observability:

- **GitHub webhook processing**: success rate, latency, retries per event type. If `pull_request.closed` handler fails silently, we miss annotation closures. Alert on > 1% failure rate.
- **Email deliverability**: Resend's dashboard covers most; we also track in-app per user whether their emails are being delivered, bouncing, or marked spam.
- **Billing funnel**: visits to /pricing → clicks on "Upgrade" → Checkout session started → session completed. PostHog funnel.
- **Trial conversion rate**: of users who start a trial, what % convert to paid? Tracked in PostHog.
- **MRR, churn, LTV**: basic SaaS metrics dashboard. Stripe's built-in revenue dashboard is fine for year 1; switch to ChartMogul or Baremetrics only if Stripe's UI becomes limiting.

### 10.2 New alerts

| Alert | Threshold | Why |
|---|---|---|
| GitHub webhook failure rate | > 1% for 10 min | Missed events break the loop |
| Stripe webhook failure rate | > 1% for 10 min | Missed events break billing |
| Email delivery failure rate | > 5% for 1 hour | Resend issue or domain reputation |
| Failed payment count | any, immediate | Someone needs manual help |
| Fly machine restart loop | any | Deploy issue |

---

## 11. Security and compliance gates

### 11.1 Must-haves before public launch

- [ ] Privacy policy, Terms of Service, DPA reviewed by a lawyer (not a template)
- [ ] `security@remarks.dev` email monitored, response SLA documented
- [ ] GitHub App private key in Fly secrets only, rotated once before launch to test rotation works
- [ ] Stripe keys in Fly secrets only
- [ ] All webhooks (Clerk, GitHub, Stripe) signature-verified; tests that unsigned or wrong-signature requests are rejected
- [ ] GDPR data export endpoint (user can request all their data as JSON)
- [ ] GDPR data deletion endpoint (user can request full deletion; 30-day soft delete then hard)
- [ ] Password/credential never stored (Clerk handles, verify by grepping our code)
- [ ] Annotation screenshots use signed URLs only; verified no public bucket access
- [ ] Rate limits tested under load (k6 run of 100 RPS for 5 min against staging)
- [ ] Backup strategy for Postgres: Neon does PITR; verify we can actually restore from a point in time
- [ ] Sentry error scrubbing: no user PII in error reports (verify by planting a test error with fake PII)

### 11.2 Nice-to-haves for Phase 3 (optional)

- SOC 2 Type I audit process started (not completed; audit itself is year 2)
- Penetration test by a reputable firm (~$5k; do before announcing enterprise interest)
- Bug bounty program (via HackerOne or similar; defer to year 2 probably)

### 11.3 What we're intentionally not doing yet

- Full SOC 2 Type II audit
- ISO 27001
- HIPAA
- On-prem / self-hosted offering
- Customer-provided encryption keys (BYOK)

Each of these is a real enterprise requirement and should wait until a specific customer is asking and willing to pay for it.

---

## 12. Task breakdown

Structured by sub-phase. Each task sized to fit in 1-2 Claude Code sessions.

### Sub-phase 3A: GitHub integration (weeks 1–6)

#### Week 1: GitHub App and infrastructure

| # | Task | Done when |
|---|---|---|
| 3A.1 | Register GitHub App in production and dev environments with permissions from §3.3 | Two apps exist; private keys downloaded |
| 3A.2 | Store GitHub App credentials in Fly secrets for api and in Vercel env for dashboard | Secrets in place, no credentials in code |
| 3A.3 | Add schemas from §8.1: `github_installations`, `github_repos`, `project_github_links` | Migration generated and applied |
| 3A.4 | Install detection endpoint: `GET /integrations/github/install-url?projectId=` returns the install URL with state | Returns correct URL for dev and prod App IDs |
| 3A.5 | Install callback handler: `GET /integrations/github/callback` receives installation_id + state, creates `github_installations` row | Integration test simulates install, verifies DB state |

#### Week 2: Webhook handling

| # | Task | Done when |
|---|---|---|
| 3A.6 | `POST /webhooks/github` with HMAC signature verification | Integration test passes with real signed payload and fails on bad signature |
| 3A.7 | Inngest function `github_process_webhook` dispatches by event type | Function registered, triggered by mock event |
| 3A.8 | Handler for `installation.created` — creates installation row, lists accessible repos via GitHub API, populates `github_repos` | End-to-end test installs app on a test org, repos appear in DB |
| 3A.9 | Handler for `installation.deleted` — soft-marks installation and repos | Uninstalling in GitHub reflects in DB within 1 minute |
| 3A.10 | Handler for `repository` events (renamed, deleted, archived) | Repo metadata stays in sync |

#### Week 3: Project linking and PR schemas

| # | Task | Done when |
|---|---|---|
| 3A.11 | Add schemas from §8.2: `pull_requests`, `annotation_pr_links` | Migration applied |
| 3A.12 | Dashboard: project settings → GitHub section with "Connect GitHub" flow | User can initiate install, link a repo to project |
| 3A.13 | `POST /projects/:id/github-link` endpoint to create `project_github_links` after install | Integration test passes |
| 3A.14 | Dashboard: project header shows connected repo; "Disconnect" action | Disconnect removes link but not installation |

#### Week 4: PR lifecycle

| # | Task | Done when |
|---|---|---|
| 3A.15 | Handler for `pull_request.opened` — parse Remarks annotation IDs from body (both the HTML comment and URL formats per §3.8) | PR opened on linked repo creates `pull_requests` row and `annotation_pr_links` rows |
| 3A.16 | Handler for `pull_request.closed` (merged) — update annotations to `done`, trigger `pr.merged` Inngest event | PR merge closes linked annotations within 1 min |
| 3A.17 | Handler for `pull_request.closed` (not merged) — revert `doing` annotations to `to_do` | Verified manually |
| 3A.18 | Handler for `pull_request.reopened` | Verified manually |
| 3A.19 | Handler for `pull_request_review.submitted` — trigger `pr.reviewed` Inngest event (for Phase 3B notifications) | Event published, not yet consumed |
| 3A.20 | Handler for `push` — update `branches.git_sha` for matching branch | Push updates SHA in DB |

#### Week 5: Status checks and real `remarks_open_pr`

| # | Task | Done when |
|---|---|---|
| 3A.21 | Implement `remarks/annotations` status check creation and updates | Status appears on PR, transitions as annotation statuses change |
| 3A.22 | Replace `remarks_open_pr` stub in MCP server: call GitHub API to open draft PR, write to DB, return URL | Agent opens real PR end-to-end |
| 3A.23 | PR description template: agent's description + footer with annotation links + HTML-comment marker | Generated PRs have correct format |
| 3A.24 | Handle edge case: branch doesn't exist on GitHub when `open_pr` called | Returns `BRANCH_NOT_FOUND` error cleanly |
| 3A.25 | Handle edge case: GitHub API rate limit or outage during `open_pr` | Queued via Inngest, retried; user sees pending state |

#### Week 6: Polish and exit criteria

| # | Task | Done when |
|---|---|---|
| 3A.26 | End-to-end test: user installs app, links repo, agent opens PR, merges, annotations close | Manual test passes |
| 3A.27 | ADR-0015: "Remarks opens PRs but does not push commits" | ADR written and committed |
| 3A.28 | Docs: GitHub integration page on `docs.remarks.dev` | Page live (docs site may still be Mintlify scaffold) |
| 3A.29 | Observability: dashboards for GitHub webhook success rate and PR lifecycle events | Charts populated in Axiom |

**Sub-phase 3A exit criteria:**
- [ ] User can install GitHub App and link a repo to a project
- [ ] Agent can open a real draft PR via `remarks_open_pr`
- [ ] PR merge closes linked annotations; PR close reverts them
- [ ] Status checks work on PRs
- [ ] At least 3 private beta users are using the GitHub integration daily

### Sub-phase 3B: Notifications (weeks 7–9)

#### Week 7: Schema and in-app inbox

| # | Task | Done when |
|---|---|---|
| 3B.1 | Add schemas from §8.3: `notifications`, `notification_preferences` | Migration applied |
| 3B.2 | Resend account, domain verification for `remarks.dev`, DKIM/SPF records added | Verification passes in Resend dashboard |
| 3B.3 | React Email templates for each notification type in `packages/shared/src/email-templates/` | All templates render; previewable via `react-email dev` |
| 3B.4 | Dashboard: notification inbox page at `/app/inbox` with list, filters, mark-read, archive | Functional UI |
| 3B.5 | Dashboard: bell icon in header with unread count badge | Real-time-ish (polling every 10s) |
| 3B.6 | `GET /notifications` and `PATCH /notifications/:id` endpoints | Integration tests pass |

#### Week 8: Inngest fan-out and email

| # | Task | Done when |
|---|---|---|
| 3B.7 | Inngest function `fanout_notifications` (see §4.6) | Test: publishing `annotation.created` creates notifications rows for recipients |
| 3B.8 | Inngest function `send_email` with Resend client, retry on failure | Test: failure triggers retry with backoff |
| 3B.9 | Event publishers: hook into annotation creation, status changes, comments, PR events | Creating an annotation publishes `annotation.created` |
| 3B.10 | Notification preference enforcement in `fanout_notifications` | Test: user with email off doesn't get email; in-app still fires |
| 3B.11 | Settings page: per-event-type email toggles, digest mode, quiet hours | Functional UI; preferences persist |

#### Week 9: Digests and polish

| # | Task | Done when |
|---|---|---|
| 3B.12 | Inngest scheduled function `daily_digest` running at 8 AM per user TZ | Test: dry-run produces correct digest content |
| 3B.13 | Unsubscribe flow: link in email → settings page with the right toggle highlighted | Click unsubscribe → correct toggle flipped |
| 3B.14 | Transactional email vs. notification email separation | Billing emails cannot be unsubscribed |
| 3B.15 | End-to-end test: trigger event → user receives email + in-app notification | Manual test passes |

**Sub-phase 3B exit criteria:**
- [ ] Every event from §4.2 triggers the right notifications for the right users
- [ ] Email delivery rate > 98% (Resend dashboard)
- [ ] In-app inbox shows correct unread counts
- [ ] Preference UI works and is honored
- [ ] Daily digest works for users who opt in

### Sub-phase 3C: Billing (weeks 10–13)

#### Week 10: Stripe setup and plan model

| # | Task | Done when |
|---|---|---|
| 3C.1 | Stripe account (live + test mode), set up products/prices per §5.3 | Price IDs available for code to reference |
| 3C.2 | Add billing columns to `organizations` table + create `plan_usage` table (§8.4) | Migration applied |
| 3C.3 | Stripe customer creation on org creation (lazy — on first interaction) | Test: creating an org → first billing interaction creates Stripe customer |
| 3C.4 | Webhook endpoint `POST /webhooks/stripe` with signature verification | Integration test |
| 3C.5 | Inngest function `reconcile_org_usage` (every 5 min) computes editor count, project count, storage used | `plan_usage` rows update on schedule |

#### Week 11: Checkout and plan enforcement

| # | Task | Done when |
|---|---|---|
| 3C.6 | Dashboard: pricing page at `/pricing` | Static content matches §5.1 |
| 3C.7 | Dashboard: billing settings page with current plan, "Upgrade" button | UI works |
| 3C.8 | `POST /billing/checkout-session` creates Stripe Checkout session with correct seat quantity | Integration test creates session |
| 3C.9 | Stripe webhook handlers: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` | Test: subscription created → `organizations.plan` flips to `team` |
| 3C.10 | Free tier enforcement middleware: checks `plan_usage` on project create, user invite, screenshot upload | Test: 2nd project creation on free → 402 response |

#### Week 12: Portal, dunning, trials

| # | Task | Done when |
|---|---|---|
| 3C.11 | Stripe Customer Portal integration: "Manage billing" button redirects to Stripe-hosted portal | Redirect works, return URL correct |
| 3C.12 | Seat-quantity sync: Clerk org membership change or project role change → recalculate editors → update Stripe subscription | Test: promoting viewer to editor bumps Stripe quantity |
| 3C.13 | Trial flow: "Start 14-day trial" button creates subscription with trial period | Test: trial subscription active; day 14 transitions correctly |
| 3C.14 | Trial expiry Inngest function: email on day 12 and day 14 | Test: schedule fires, emails sent |
| 3C.15 | Payment failure handling: `invoice.payment_failed` → email owner + dashboard banner | Test: forced failure in Stripe test mode triggers correct flow |

#### Week 13: Retention and edge cases

| # | Task | Done when |
|---|---|---|
| 3C.16 | Free tier retention sweep: Inngest daily job, deletes annotations > 30 days old on free orgs, emails 7 days before | Test: seeded old annotation gets deleted on next run |
| 3C.17 | Downgrade flow: `subscription.deleted` → flip to free → enforce limits on next request (no immediate deletion) | Test: downgraded org can still view data but can't create new projects |
| 3C.18 | Tax: Stripe Tax enabled for live account | Checkout displays correct tax for test customers |
| 3C.19 | Billing audit: verify no code path bypasses limits in the free tier | Manual review + penetration attempt |
| 3C.20 | Dashboard: usage page showing current plan usage vs. limits | UI shows all three limits (projects, users, storage) |

**Sub-phase 3C exit criteria:**
- [ ] Anyone can sign up free, use the product, hit limits, upgrade to Team via Stripe, and downgrade
- [ ] Seat quantity stays in sync between Remarks and Stripe
- [ ] Failed payments surface clearly; no silent downgrades
- [ ] At least 5 beta users have completed a paid upgrade
- [ ] Stripe Tax handles tax correctly for at least 3 different countries

### Sub-phase 3D: Marketing + launch (weeks 14–18)

#### Week 14: Marketing site

| # | Task | Done when |
|---|---|---|
| 3D.1 | Marketing routes in dashboard app: `/`, `/pricing`, `/about`, `/for-designers`, `/for-developers`, `/for-pms` | Pages live at `remarks.dev` |
| 3D.2 | Home page: hero, demo video placeholder, "how it works" section, social proof, CTA | Visual parity with plan |
| 3D.3 | Pricing page: free vs Team table, FAQ section | Matches §5.1 |
| 3D.4 | Three persona pages (or one combined page) | Shipped |
| 3D.5 | Legal pages: Privacy Policy, Terms of Service, DPA (lawyer-reviewed) | Live at `/privacy`, `/terms`, `/dpa` |
| 3D.6 | Changelog page pulling from GitHub Releases API or a markdown file | Live, auto-updating or manually maintained |

#### Week 15: Docs site

| # | Task | Done when |
|---|---|---|
| 3D.7 | Mintlify account, configure `docs.remarks.dev` | Docs site live with blank scaffold |
| 3D.8 | "Getting Started" section: install, create project, first annotation, connect agent | All 4 pages written |
| 3D.9 | Agent setup pages: one per agent, each showing install snippet + troubleshooting | Claude Code, Cursor, Windsurf, Codex, Copilot, Generic MCP all covered |
| 3D.10 | MCP reference page auto-generated from `packages/mcp-schema` | Build script runs in CI and updates docs |
| 3D.11 | API reference auto-generated from Zod schemas | Build script runs in CI |
| 3D.12 | Concepts + Integrations + Troubleshooting sections | All written |

#### Week 16: Launch assets

| # | Task | Done when |
|---|---|---|
| 3D.13 | Demo video recorded, edited, uploaded to YouTube | Video published |
| 3D.14 | Embed demo video on home page and docs Getting Started | Embedded and playing |
| 3D.15 | OG images for every page of marketing and docs site | Twitter/LinkedIn shares look good |
| 3D.16 | Status page at `status.remarks.dev` | Live, reporting |
| 3D.17 | Support email setup: `support@remarks.dev` forwards to your inbox; saved replies drafted for common questions | Email works |
| 3D.18 | `security@remarks.dev` with security policy page at `/security` | Email works, page live |

#### Week 17: Pre-launch checklist + rehearsal

| # | Task | Done when |
|---|---|---|
| 3D.19 | Run the full pre-launch checklist from §7.2 | All boxes checked |
| 3D.20 | Load test: k6 simulating 10× normal traffic for 30 min against staging | No cascading failures |
| 3D.21 | Chaos test: kill one Fly machine while processing a real annotation; verify recovery | Annotation still processes |
| 3D.22 | Dry-run the launch posts (Twitter, HN, Product Hunt) with a trusted friend | Copy is ready |
| 3D.23 | Set up Plausible or keep PostHog for public-site analytics | Analytics tracking launch traffic |
| 3D.24 | Final security review: grep for TODO/FIXME/hardcoded secrets; fix any found | Clean |

#### Week 18: Launch

| # | Task | Done when |
|---|---|---|
| 3D.25 | Monday: social media launch posts | Posted |
| 3D.26 | Tuesday: HN "Show HN" post | Posted; active in comments |
| 3D.27 | Wednesday: Product Hunt launch | Live |
| 3D.28 | Thursday: respond to all feedback; ship any urgent fixes | Clean |
| 3D.29 | Friday: email to all beta users and mailing list | Sent |
| 3D.30 | Post-launch retro: what worked, what didn't, what to do in the next 30 days | Doc written |

**Sub-phase 3D exit criteria:**
- [ ] `remarks.dev`, `docs.remarks.dev`, and `app.remarks.dev` all live and working
- [ ] Demo video published
- [ ] Extension approved and published on Chrome Web Store and Edge Add-ons
- [ ] Launched publicly with coordinated comms
- [ ] At least 10 new signups in launch week (indicative, not a hard gate)

---

## 13. Exit criteria for Phase 3

The whole phase is done when all of these are true:

- [ ] A stranger can sign up on `remarks.dev`, install the extension, create a project, connect GitHub, connect an agent, file an annotation, have the agent open a PR, merge it, and receive an email — all without speaking to anyone.
- [ ] Free tier limits are enforced; upgrade to Team works end-to-end; downgrade works.
- [ ] GitHub integration is reliable (< 1% webhook failure rate over 30 days).
- [ ] Notifications are reliable (> 98% email delivery; in-app always fires).
- [ ] At least 10 paying customers on Team tier.
- [ ] MRR > $500 (indicative of real revenue, not a hard gate).
- [ ] No known P0 or P1 bugs.
- [ ] All observability dashboards populated; alerts functional.
- [ ] All legal pages live and lawyer-reviewed.
- [ ] Post-launch retro written and shared (with yourself, if no one else).

When all of these are true, Phase 3 ships and the next milestone is Phase 4 (Business tier: Figma, tokens, policies, drift — the year 2 work).

---

## Appendix A: things explicitly deferred to year 2

So the next spec author isn't surprised by what's missing:

- **Business tier features**: Figma integration, design tokens, Code Connect, policy engine, drift detection, review gates, audit log UI, RBAC beyond admin/editor/viewer.
- **Enterprise features**: SSO via WorkOS, SAML, SCIM provisioning, DPA negotiation, SOC 2 Type II, self-hosted option, BYOK.
- **Additional channels**: Slack, Linear, Jira, Teams, Discord, webhooks.
- **Additional git providers**: GitLab, Bitbucket, Azure DevOps.
- **Additional agents**: any that aren't in Phase 2's supported set at launch.
- **Additional surfaces**: VS Code extension, Safari extension, Firefox extension, desktop app (Tauri), mobile apps.
- **Advanced analytics**: customer-facing product analytics, team velocity reporting.
- **Marketplace**: Skill pack marketplace, revenue share, partner ecosystem.
- **AI capabilities beyond what's in the Skill**: auto-triage of annotations, duplicate detection, semantic search.

Each of these is a real future bet. None is a blocker for Phase 3 launch. Don't let scope creep pull them in.
