#!/usr/bin/env tsx
/**
 * Preflight for Deploy API: verify every required env var in the Zod schema is
 * provided by either the Fly app's `[env]` block or its `secrets` list. Catches
 * the class of regression that broke the task 1.2 deploy (CLERK_SECRET_KEY
 * added to envSchema but never set as a Fly secret → crash loop on boot).
 *
 * Exit codes: 0 = all required keys present; 1 = missing keys or flyctl error.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { envSchema } from "../src/env-schema.js";
import { findMissingKeys, parseFlyTomlEnvKeys, requiredEnvKeys } from "../src/lib/env-check.js";

const APP_NAME = process.env.FLY_APP_NAME ?? "remarks-api";
const here = dirname(fileURLToPath(import.meta.url));
const flyTomlPath = resolve(here, "..", "fly.toml");

function flySecretNames(app: string): Set<string> {
  const res = spawnSync("flyctl", ["secrets", "list", "--app", app, "--json"], {
    encoding: "utf8",
  });
  if (res.status !== 0) {
    throw new Error(
      `flyctl secrets list failed (exit ${res.status}): ${res.stderr.trim() || res.stdout.trim()}`
    );
  }
  const parsed = JSON.parse(res.stdout) as Array<{ name: string }>;
  return new Set(parsed.map((s) => s.name));
}

const required = requiredEnvKeys(envSchema);
const flyEnvKeys = parseFlyTomlEnvKeys(readFileSync(flyTomlPath, "utf8"));
const secretNames = flySecretNames(APP_NAME);
const missing = findMissingKeys(required, flyEnvKeys, secretNames);

if (missing.length > 0) {
  console.error(`Required env vars missing from Fly app "${APP_NAME}":`);
  for (const key of missing) console.error(`  - ${key}`);
  console.error("\nSet each one with:");
  console.error(`  flyctl secrets set ${missing[0]}=... --app ${APP_NAME}`);
  console.error(`\nOr add static values to apps/api/fly.toml [env] if they're non-secret.`);
  process.exit(1);
}

console.log(`All ${required.length} required env vars present on Fly app "${APP_NAME}".`);
