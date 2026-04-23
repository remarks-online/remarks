import { fileURLToPath } from "node:url";
import { type Client, type DB, createClient, schema } from "@remarks/db";
import { migrate } from "drizzle-orm/postgres-js/migrator";

interface Cached {
  client: Client;
  db: DB;
}

let cached: Cached | null = null;

function migrationsFolder(): string {
  return fileURLToPath(new URL("../../../../packages/db/drizzle/", import.meta.url));
}

export async function getIntegrationDb(): Promise<DB> {
  if (cached) return cached.db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required for integration tests");
  }
  const client = createClient(url);
  await migrate(client.db, { migrationsFolder: migrationsFolder() });
  cached = { client, db: client.db };
  return client.db;
}

export async function closeIntegrationDb(): Promise<void> {
  if (!cached) return;
  await cached.client.sql.end({ timeout: 5 });
  cached = null;
}

export async function truncateAll(): Promise<void> {
  if (!cached) {
    throw new Error("truncateAll: call getIntegrationDb() first");
  }
  const rows = await cached.client.sql<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE 'drizzle_%'
      AND tablename NOT LIKE '__drizzle%'
  `;
  if (rows.length === 0) return;
  const qualified = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await cached.client.sql.unsafe(`TRUNCATE ${qualified} RESTART IDENTITY CASCADE`);
}

const rand = () => Math.random().toString(36).slice(2, 10);

export async function seedOrg(
  db: DB,
  overrides: Partial<typeof schema.organizations.$inferInsert> = {}
): Promise<typeof schema.organizations.$inferSelect> {
  const [row] = await db
    .insert(schema.organizations)
    .values({
      clerkOrgId: `org_${rand()}`,
      name: "Test Org",
      slug: `org-${rand()}`,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("seedOrg: insert returned no rows");
  return row;
}

export async function seedUser(
  db: DB,
  overrides: Partial<typeof schema.users.$inferInsert> = {}
): Promise<typeof schema.users.$inferSelect> {
  const [row] = await db
    .insert(schema.users)
    .values({
      clerkUserId: `user_${rand()}`,
      email: `test-${rand()}@example.com`,
      name: "Test User",
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("seedUser: insert returned no rows");
  return row;
}
