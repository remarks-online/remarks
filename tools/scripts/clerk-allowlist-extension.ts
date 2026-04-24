#!/usr/bin/env -S tsx
/**
 * Append a chrome-extension://<id> origin to a Clerk instance's
 * allowed_origins. GETs the current list so the PATCH merges instead of
 * replacing. Idempotent — re-running with the same origin is a no-op.
 *
 * Usage:
 *   CLERK_SECRET_KEY=sk_... pnpm --filter @remarks/scripts exec tsx \
 *     clerk-allowlist-extension.ts baikikfefeheiildmfoaicbjbnbecgjd
 *
 * The secret key scope (sk_test_ vs sk_live_) selects which Clerk instance
 * (dev vs prod) receives the update; run once per instance.
 */

const API = "https://api.clerk.com/v1";

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

const secret = process.env.CLERK_SECRET_KEY;
if (!secret || !secret.startsWith("sk_")) {
  fail("CLERK_SECRET_KEY env var is required (sk_test_… or sk_live_…)");
}

const extensionId = process.argv[2];
if (!extensionId) {
  fail("usage: clerk-allowlist-extension.ts <extension-id>");
}
if (!/^[a-p]{32}$/.test(extensionId)) {
  fail(`extension id must be 32 lowercase chars in [a-p], got: ${extensionId}`);
}

const extOrigin = `chrome-extension://${extensionId}`;

const headers = {
  Authorization: `Bearer ${secret}`,
  "Content-Type": "application/json",
};

const getRes = await fetch(`${API}/instance`, { headers });
if (!getRes.ok) {
  fail(`GET /v1/instance failed: ${getRes.status} ${await getRes.text()}`);
}
const instance = (await getRes.json()) as { allowed_origins?: string[] | null };
const current = instance.allowed_origins ?? [];

if (current.includes(extOrigin)) {
  console.log(`already allowlisted: ${extOrigin}`);
  console.log(`existing allowed_origins: ${JSON.stringify(current)}`);
  process.exit(0);
}

const next = [...current, extOrigin];

const patchRes = await fetch(`${API}/instance`, {
  method: "PATCH",
  headers,
  body: JSON.stringify({ allowed_origins: next }),
});
if (!patchRes.ok) {
  fail(`PATCH /v1/instance failed: ${patchRes.status} ${await patchRes.text()}`);
}

console.log(`allowlisted: ${extOrigin}`);
console.log(`allowed_origins now: ${JSON.stringify(next)}`);

export {};
