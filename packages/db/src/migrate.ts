import { readFile } from "node:fs/promises";
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

  // Drizzle's migrator decides what's pending by comparing each journal
  // entry's `when` against `max(created_at)` in __drizzle_migrations and
  // skipping any whose `when` is not strictly greater. If a prior journal
  // entry's `when` was set to a future date (or is otherwise out of order),
  // a later migration with an earlier `when` is silently skipped — the
  // migrate command exits 0 with no output. Assert that the last journal
  // entry's `when` matches the latest applied row so this fails loudly.
  const journalRaw = await readFile(resolve(migrationsFolder, "meta/_journal.json"), "utf8");
  const journal = JSON.parse(journalRaw) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };
  const lastEntry = journal.entries[journal.entries.length - 1];
  if (!lastEntry) throw new Error("Drizzle journal has no entries");
  const [latestApplied] = await sql<{ created_at: string | number }[]>`
    select created_at from drizzle.__drizzle_migrations order by id desc limit 1
  `;
  if (!latestApplied) {
    throw new Error("No rows in drizzle.__drizzle_migrations after migrate()");
  }
  const latestAppliedWhen = Number(latestApplied.created_at);
  if (latestAppliedWhen !== lastEntry.when) {
    throw new Error(
      `Drizzle migration drift: journal's last entry is ${lastEntry.tag} (when=${lastEntry.when}) but DB latest created_at=${latestAppliedWhen}. Drizzle silently skipped a migration — check that all journal \`when\` values are monotonically increasing.`
    );
  }
} finally {
  await sql.end({ timeout: 5 });
}
