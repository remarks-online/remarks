// Postgres SQLSTATE for unique-constraint violations. postgres.js surfaces the
// original error code unchanged; drizzle propagates it as-is.
const PG_UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === PG_UNIQUE_VIOLATION || e?.cause?.code === PG_UNIQUE_VIOLATION;
}
