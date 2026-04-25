import type { ClerkClient, Organization, User } from "@clerk/backend";
import { type DB, schema } from "@remarks/db";
import type { ClerkOrgData, ClerkUserData } from "@remarks/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

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

export async function deleteOrg(db: DB, clerkOrgId: string): Promise<void> {
  // FK cascades handle projects → branches → annotations → events/assets.
  // TODO(phase-2): publish to Inngest for R2 object cleanup per ADR-0014 §3.
  await db.delete(schema.organizations).where(eq(schema.organizations.clerkOrgId, clerkOrgId));
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
