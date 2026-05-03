import { expect, test } from "./fixtures.js";

// X1 follow-up: a user-facing schema reference under /app/docs/schema. Mirrors
// the agentation.com/schema doc but renders live production Badges next to
// each enum value. Linked from /app/connect-agent.

test("connect-agent links to the schema reference and the page renders all sections", async ({
  signedInPage,
}) => {
  await signedInPage.goto("/app/connect-agent");
  await signedInPage.getByRole("link", { name: /See annotation schema reference/ }).click();
  await signedInPage.waitForURL(/\/app\/docs\/schema$/);

  await expect(
    signedInPage.getByRole("heading", { name: "Annotation schema reference" })
  ).toBeVisible();

  for (const heading of [
    "Overview",
    "Annotation object",
    "Classification enums",
    "DOM context",
    "Annotation events",
    "Real-time stream (SSE)",
    "Outbound webhooks",
    "Versioning",
  ]) {
    await expect(signedInPage.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
});

test("schema reference renders intent / severity / status badges with their canonical labels", async ({
  signedInPage,
}) => {
  await signedInPage.goto("/app/docs/schema");
  await expect(
    signedInPage.getByRole("heading", { name: "Annotation schema reference" })
  ).toBeVisible();

  // Intent badges: Fix / Change / Question / Approve.
  for (const label of ["Fix", "Change", "Question", "Approve"]) {
    await expect(signedInPage.getByText(label, { exact: true }).first()).toBeVisible();
  }

  // Severity badges: Blocking / Important / Suggestion.
  for (const label of ["Blocking", "Important", "Suggestion"]) {
    await expect(signedInPage.getByText(label, { exact: true }).first()).toBeVisible();
  }

  // Status badges: To do / In progress / Done / Rejected / Acknowledged.
  for (const label of ["To do", "In progress", "Done", "Rejected", "Acknowledged"]) {
    await expect(signedInPage.getByText(label, { exact: true }).first()).toBeVisible();
  }
});
