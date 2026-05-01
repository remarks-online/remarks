import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type DatabaseUrl = string;

// Re-exported so apps/api (and any other workspace package) can type the
// underlying postgres-js client (e.g. for NOTIFY in the SSE event bus, G9)
// without taking a direct `postgres` runtime dep.
export type Sql = postgres.Sql;

export function createClient(url: DatabaseUrl) {
  const sql = postgres(url, {
    max: 10,
    // Neon's pgbouncer-backed pooled endpoint does not support server-side
    // prepared statements. Harmless when connecting to the direct endpoint.
    prepare: false,
  });
  const db = drizzle(sql, { schema, logger: process.env.DB_LOG === "1" });
  return { db, sql };
}

// Dedicated single-connection client for LISTEN. Calling sql.listen on the
// shared application pool turned out to interfere with concurrent integration
// tests (one Vitest run hung other test files' truncate/seed cycles), so we
// open a parallel client for the listener only. Used by the G9 SSE event bus.
export function createListenClient(url: DatabaseUrl) {
  return postgres(url, {
    max: 1,
    prepare: false,
    // The listen socket should outlive any pool idle timer.
    idle_timeout: 0,
    max_lifetime: 0,
  });
}

export type Client = ReturnType<typeof createClient>;
export type DB = Client["db"];
