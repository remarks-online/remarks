import type { ZodObject, ZodRawShape, ZodType } from "zod";

/**
 * Returns the keys of `schema` whose types reject `undefined`. These are the
 * env vars that must be present at boot — keys with `.default()` or
 * `.optional()` accept `undefined` and are excluded.
 */
export function requiredEnvKeys(schema: ZodObject<ZodRawShape>): string[] {
  const required: string[] = [];
  const entries = Object.entries(schema.shape) as Array<[string, ZodType]>;
  for (const [key, type] of entries) {
    if (!type.safeParse(undefined).success) required.push(key);
  }
  return required.sort();
}

/**
 * Extracts the keys defined in the `[env]` table of a fly.toml source string.
 * Only handles the subset fly.toml actually uses: `KEY = "value"` or
 * `KEY = number` on their own lines. Fly's TOML dialect is intentionally flat
 * here, so a full parser isn't needed and keeps the check dep-free.
 */
export function parseFlyTomlEnvKeys(toml: string): Set<string> {
  const block = toml.match(/(^|\n)\[env\]\r?\n([\s\S]*?)(?=\r?\n\[[A-Za-z]|\s*$)/);
  const body = block?.[2];
  if (body === undefined) return new Set();
  const keys = new Set<string>();
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    const name = m?.[1];
    if (name !== undefined) keys.add(name);
  }
  return keys;
}

/** Required keys that are provided by neither `[env]` nor the secrets list. */
export function findMissingKeys(
  required: readonly string[],
  flyEnvKeys: ReadonlySet<string>,
  secretNames: ReadonlySet<string>
): string[] {
  return required.filter((k) => !flyEnvKeys.has(k) && !secretNames.has(k));
}
