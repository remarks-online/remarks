import { createClient, schema } from "@remarks/db";
import { ensureClerkOrg, ensureClerkUser } from "./clerk.js";
import {
  TEST_ORG_NAME,
  TEST_PROJECT_NAME,
  TEST_PROJECT_SLUG,
  TEST_USER_EMAIL,
  TEST_USER_PASSWORD,
} from "./constants.js";

async function seedDatabase(
  databaseUrl: string,
  clerk: { userId: string; orgId: string; orgSlug: string }
): Promise<void> {
  const { db, sql: pgSql } = createClient(databaseUrl);
  try {
    const [user] = await db
      .insert(schema.users)
      .values({
        clerkUserId: clerk.userId,
        email: TEST_USER_EMAIL,
        name: "Dev Tester",
        avatarUrl: null,
      })
      .onConflictDoUpdate({
        target: schema.users.clerkUserId,
        set: {
          email: TEST_USER_EMAIL,
          name: "Dev Tester",
          updatedAt: new Date(),
          deletedAt: null,
        },
      })
      .returning();
    if (!user) throw new Error("user upsert returned no row");

    const [org] = await db
      .insert(schema.organizations)
      .values({ clerkOrgId: clerk.orgId, name: TEST_ORG_NAME, slug: clerk.orgSlug })
      .onConflictDoUpdate({
        target: schema.organizations.clerkOrgId,
        set: { name: TEST_ORG_NAME, slug: clerk.orgSlug, updatedAt: new Date() },
      })
      .returning();
    if (!org) throw new Error("org upsert returned no row");

    const [project] = await db
      .insert(schema.projects)
      .values({
        orgId: org.id,
        name: TEST_PROJECT_NAME,
        slug: TEST_PROJECT_SLUG,
        primaryBranch: "main",
      })
      .onConflictDoNothing()
      .returning();

    const projectId =
      project?.id ??
      (
        await db.query.projects.findFirst({
          where: (p, { and, eq }) => and(eq(p.orgId, org.id), eq(p.slug, TEST_PROJECT_SLUG)),
        })
      )?.id;
    if (!projectId) throw new Error("project seed failed");

    await db
      .insert(schema.projectMembers)
      .values({ projectId, userId: user.id, role: "admin" })
      .onConflictDoNothing();
  } finally {
    await pgSql.end({ timeout: 5 });
  }
}

export default async function globalSetup(): Promise<void> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const databaseUrl = process.env.DATABASE_URL;
  if (!secretKey?.startsWith("sk_test_")) {
    throw new Error(
      "CLERK_SECRET_KEY must be a dev (sk_test_*) key — refusing to seed against a prod Clerk instance"
    );
  }
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for E2E setup");
  }

  const user = await ensureClerkUser(secretKey, TEST_USER_EMAIL, {
    password: TEST_USER_PASSWORD,
    firstName: "Dev",
    lastName: "Tester",
  });
  const org = await ensureClerkOrg(secretKey, TEST_ORG_NAME, user.id);
  await seedDatabase(databaseUrl, {
    userId: user.id,
    orgId: org.id,
    orgSlug: org.slug,
  });

  // Hand off the provisioned IDs to per-test fixtures. Fixtures mint a fresh
  // sign-in token per test (they're single-use + short-lived), so we don't
  // create one here.
  process.env.E2E_CLERK_USER_ID = user.id;
  process.env.E2E_CLERK_ORG_ID = org.id;
}
