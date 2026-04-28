import type { ClerkClient, Organization, User } from "@clerk/backend";
import { type DB, schema } from "@remarks/db";
import type { ClerkOrgData, ClerkUserData } from "@remarks/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import type { AppInngest } from "../inngest/client.js";
import { publishR2Cleanup } from "../inngest/publish.js";
import type { OrgMembership } from "../trpc/trpc.js";

function pickEmail(data: ClerkUserData): string | null {
  const primary = data.email_addresses.find((e) => e.id === data.primary_email_address_id);
  return primary?.email_address ?? data.email_addresses[0]?.email_address ?? null;
}

function buildName(data: ClerkUserData): string | null {
  const combined = [data.first_name, data.last_name].filter(Boolean).join(" ");
  return combined.length > 0 ? combined : null;
}

export async function upsertUser(db: DB, data: ClerkUserData): Promise<void> {
  const email = pickEmail(data);
  const name = buildName(data);
  await db
    .insert(schema.users)
    .values({
      clerkUserId: data.id,
      email,
      name,
      avatarUrl: data.image_url,
    })
    .onConflictDoUpdate({
      target: schema.users.clerkUserId,
      set: {
        email,
        name,
        avatarUrl: data.image_url,
        deletedAt: null,
        updatedAt: sql`now()`,
      },
    });
}

// Soft-delete per ADR-0014 §3: null out PII, keep the row so annotations
// authored by this user still have a valid FK target. A scheduled job hard-
// deletes after 30 days (not built yet).
export async function softDeleteUser(db: DB, clerkUserId: string): Promise<void> {
  await db
    .update(schema.users)
    .set({
      deletedAt: sql`now()`,
      email: null,
      name: null,
      avatarUrl: null,
      updatedAt: sql`now()`,
    })
    .where(eq(schema.users.clerkUserId, clerkUserId));
}

export async function upsertOrg(db: DB, data: ClerkOrgData): Promise<void> {
  await db
    .insert(schema.organizations)
    .values({
      clerkOrgId: data.id,
      name: data.name,
      slug: data.slug,
    })
    .onConflictDoUpdate({
      target: schema.organizations.clerkOrgId,
      set: {
        name: data.name,
        slug: data.slug,
        updatedAt: sql`now()`,
      },
    });
}

export async function deleteOrg(db: DB, inngest: AppInngest, clerkOrgId: string): Promise<void> {
  // Resolve to the local row first so the JOIN below can use the same id
  // path we cascade through. If the org doesn't exist we no-op (matches
  // pre-Inngest behavior — Clerk webhook deliveries can race).
  const org = await db.query.organizations.findFirst({
    where: eq(schema.organizations.clerkOrgId, clerkOrgId),
    columns: { id: true },
  });
  if (!org) return;

  // Walk org → projects → annotations → annotation_assets to capture every
  // R2 key. The cascade fires on the DELETE below and will erase these rows.
  const assetKeys = await db
    .select({ r2Key: schema.annotationAssets.r2Key })
    .from(schema.annotationAssets)
    .innerJoin(schema.annotations, eq(schema.annotations.id, schema.annotationAssets.annotationId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.annotations.projectId))
    .where(eq(schema.projects.orgId, org.id));

  // FK cascades handle projects → branches → annotations → events/assets.
  await db.delete(schema.organizations).where(eq(schema.organizations.clerkOrgId, clerkOrgId));

  await publishR2Cleanup(
    inngest,
    assetKeys.map((k) => k.r2Key),
    `org:${clerkOrgId}`
  );
}

export function clerkUserToWebhookData(user: User): ClerkUserData {
  return {
    id: user.id,
    email_addresses: user.emailAddresses.map((e) => ({
      id: e.id,
      email_address: e.emailAddress,
    })),
    primary_email_address_id: user.primaryEmailAddressId,
    first_name: user.firstName,
    last_name: user.lastName,
    image_url: user.imageUrl,
  };
}

// Backstop for the /webhooks/clerk handler: fetches the Clerk user by id and
// upserts the local row. Used by the auth plugin when verifyToken succeeds but
// no users row exists yet (local dev runs without ngrok per
// docs/runbooks/setup.md:124, and in prod webhooks can lag/fail). Returns the
// freshly-loaded row, or null if the upsert somehow didn't land (FK race etc).
export async function provisionUserFromClerk(
  db: DB,
  clerk: ClerkClient,
  clerkUserId: string
): Promise<typeof schema.users.$inferSelect | null> {
  const user = await clerk.users.getUser(clerkUserId);
  await upsertUser(db, clerkUserToWebhookData(user));
  const row = await db.query.users.findFirst({
    where: and(eq(schema.users.clerkUserId, clerkUserId), isNull(schema.users.deletedAt)),
  });
  return row ?? null;
}

// Backstop for the organization.* webhooks: ensures the local `organizations`
// row exists for every Clerk org the request's user is a member of. Called
// from the auth plugin on each request; the membership list already carries
// the full Organization object (name, slug), so no extra Clerk fetch is needed.
export async function provisionOrgsFromMemberships(
  db: DB,
  memberships: ReadonlyArray<{ organization: Pick<Organization, "id" | "name" | "slug"> }>
): Promise<void> {
  if (memberships.length === 0) return;
  const orgIds = memberships.map((m) => m.organization.id);
  const existing = await db.query.organizations.findMany({
    where: inArray(schema.organizations.clerkOrgId, orgIds),
    columns: { clerkOrgId: true },
  });
  const existingIds = new Set(existing.map((o) => o.clerkOrgId));
  for (const m of memberships) {
    if (existingIds.has(m.organization.id)) continue;
    await upsertOrg(db, {
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
    });
  }
}

// Resolves the local user.id for a Clerk user id, optionally provisioning a
// missing row from Clerk. Used by the membership-sync helpers below.
async function resolveLocalUserId(
  db: DB,
  clerkUserId: string,
  opts: { clerk?: ClerkClient } = {}
): Promise<string | null> {
  const existing = await db.query.users.findFirst({
    where: and(eq(schema.users.clerkUserId, clerkUserId), isNull(schema.users.deletedAt)),
    columns: { id: true },
  });
  if (existing) return existing.id;
  if (!opts.clerk) return null;
  const provisioned = await provisionUserFromClerk(db, opts.clerk, clerkUserId);
  return provisioned?.id ?? null;
}

// Adds (or no-ops) an `editor` project_members row for `clerkUserId` on every
// existing project in `clerkOrgId`. Idempotent: ON CONFLICT preserves any
// existing role (e.g. the project creator's `admin`). If the local org or
// user row doesn't exist yet, this is a no-op — the auth-plugin backstop will
// re-run the same fan-out on the user's next authenticated request once
// upstream webhooks have caught up.
export async function syncProjectMembersForOrgMember(
  db: DB,
  clerkOrgId: string,
  clerkUserId: string,
  opts: { clerk?: ClerkClient } = {}
): Promise<void> {
  const org = await db.query.organizations.findFirst({
    where: eq(schema.organizations.clerkOrgId, clerkOrgId),
    columns: { id: true },
  });
  if (!org) return;
  const userId = await resolveLocalUserId(db, clerkUserId, opts);
  if (!userId) return;

  const projects = await db.query.projects.findMany({
    where: eq(schema.projects.orgId, org.id),
    columns: { id: true },
  });
  if (projects.length === 0) return;

  await db
    .insert(schema.projectMembers)
    .values(
      projects.map((p) => ({
        projectId: p.id,
        userId,
        role: "editor" as const,
      }))
    )
    .onConflictDoNothing();
}

// Removes all project_members rows for the user across every project in the
// given Clerk org. Idempotent.
export async function removeProjectMembersForOrgMember(
  db: DB,
  clerkOrgId: string,
  clerkUserId: string
): Promise<void> {
  const org = await db.query.organizations.findFirst({
    where: eq(schema.organizations.clerkOrgId, clerkOrgId),
    columns: { id: true },
  });
  if (!org) return;
  const userId = await resolveLocalUserId(db, clerkUserId);
  if (!userId) return;

  const projects = await db.query.projects.findMany({
    where: eq(schema.projects.orgId, org.id),
    columns: { id: true },
  });
  if (projects.length === 0) return;

  await db.delete(schema.projectMembers).where(
    and(
      eq(schema.projectMembers.userId, userId),
      inArray(
        schema.projectMembers.projectId,
        projects.map((p) => p.id)
      )
    )
  );
}

// Auth-plugin backstop: ensures the caller has a project_members row on every
// project in their Clerk-confirmed orgs. Two queries per request: a SELECT
// that finds projects where the user has no membership yet, and (only if any
// were found) one batch INSERT. Warm requests where state is already in sync
// pay only the SELECT. Webhook-driven sync is the primary path; this catches
// webhook lag and the "local dev runs without ngrok" case (docs/runbooks/setup.md).
export async function provisionProjectMembersFromOrgMemberships(
  db: DB,
  userId: string,
  memberships: ReadonlyArray<Pick<OrgMembership, "clerkOrgId">>
): Promise<void> {
  if (memberships.length === 0) return;
  const clerkOrgIds = memberships.map((m) => m.clerkOrgId);

  const missing = await db
    .select({ projectId: schema.projects.id })
    .from(schema.projects)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.projects.orgId))
    .leftJoin(
      schema.projectMembers,
      and(
        eq(schema.projectMembers.projectId, schema.projects.id),
        eq(schema.projectMembers.userId, userId)
      )
    )
    .where(
      and(
        inArray(schema.organizations.clerkOrgId, clerkOrgIds),
        isNull(schema.projectMembers.userId)
      )
    );

  if (missing.length === 0) return;

  await db
    .insert(schema.projectMembers)
    .values(
      missing.map((m) => ({
        projectId: m.projectId,
        userId,
        role: "editor" as const,
      }))
    )
    .onConflictDoNothing();
}
