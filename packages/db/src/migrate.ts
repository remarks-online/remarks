import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createClient } from "./client.js";

config({ path: [".env.local", ".env"] });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is required to run migrations");
}

// Neon's pgbouncer pooler breaks drizzle-kit's migration transactions; fail
// fast with the fix in the message so an auth/transaction error doesn't send
// the next person down a 30-min debug trail.
if (/-pooler\./.test(new URL(url).host)) {
  throw new Error(
    "DATABASE_URL points at a Neon pooler endpoint; migrations need the direct (non-pooler) endpoint. " +
      "Run `neonctl connection-string <branch> --pooled false` or copy from the Neon console with 'Connection pooling' unchecked."
  );
}

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, "../drizzle");

const { db, sql } = createClient(url);
try {
  await migrate(db, { migrationsFolder });
} finally {
  await sql.end({ timeout: 5 });
}
