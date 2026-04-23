// Test-user details are shared between global setup (which provisions Clerk +
// DB state) and the specs (which sign in + assert on the rendered UI). The
// values here identify a fixture user on the Clerk *dev* instance only — not
// a secret.
export const TEST_USER_EMAIL = process.env.E2E_TEST_EMAIL ?? "remarks-test+clerk_test@example.com";

// Must satisfy the Clerk password policy (length + character mix).
export const TEST_USER_PASSWORD = process.env.E2E_TEST_PASSWORD ?? "test-password-123!long";

export const TEST_ORG_NAME = "Remarks Dev Org";
export const TEST_PROJECT_NAME = "E2E Seed Project";
export const TEST_PROJECT_SLUG = "e2e-seed-project";

// A second Clerk org + project the test user is also a member of. Used by
// org-switcher.spec.ts to verify that switching orgs in the UI re-fetches the
// project list. Provisioned lazily by that spec (per the README guideline:
// spec-specific seeding lives in the spec, not global-setup).
export const TEST_SECONDARY_ORG_NAME = "Remarks Dev Org Secondary";
export const TEST_SECONDARY_PROJECT_NAME = "E2E Seed Project Secondary";
export const TEST_SECONDARY_PROJECT_SLUG = "e2e-seed-project-secondary";
