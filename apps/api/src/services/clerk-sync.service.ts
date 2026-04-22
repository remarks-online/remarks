import { type DB, schema } from "@remarks/db";
import type { ClerkOrgData, ClerkUserData } from "@remarks/shared";
import { eq, sql } from "drizzle-orm";

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
