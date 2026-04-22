import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type DatabaseUrl = string;

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

export type Client = ReturnType<typeof createClient>;
export type DB = Client["db"];
