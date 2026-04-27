import { schema } from "@remarks/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  closeIntegrationDb,
  getIntegrationDb,
  seedOrg,
  seedUser,
  truncateAll,
} from "../../../test/integration/db.js";

vi.mock("@clerk/backend", () => ({
  verifyToken: vi.fn(),
  createClerkClient: () => ({
    users: { getOrganizationMembershipList: vi.fn(), getUser: vi.fn() },
    organizations: { getOrganizationMembershipList: vi.fn() },
  }),
}));

const { buildServer } = await import("../../server.js");

const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN as string;

type Db = Awaited<ReturnType<typeof getIntegrationDb>>;

function rand(): string {
  return Math.random().toString(36).slice(2, 10);
}

// Org membership is sourced indirectly: a user is "in" an org when they're a
// member of at least one project in that org. This mirrors the production
// data model — Clerk owns org membership upstream, but we only see it here
// once project_members has a row.
async function seedUserInOrg(db: Db) {
  const org = await seedOrg(db);
  const user = await seedUser(db);
  const [project] = await db
    .insert(schema.projects)
    .values({
      orgId: org.id,
      name: `Project ${rand()}`,
      slug: `proj-${rand()}`,
      primaryBranch: "main",
    })
    .returning();
  if (!project) throw new Error("project insert returned no rows");
  await db
    .insert(schema.projectMembers)
    .values({ projectId: project.id, userId: user.id, role: "editor" });
  return { org, user, project };
}

describe("GET /internal/users/:clerkUserId/orgs (integration, A21)", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    await getIntegrationDb();
    server = await buildServer();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    await closeIntegrationDb();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  test("returns the user's accessible orgs", async () => {
    const db = await getIntegrationDb();
    const { org, user } = await seedUserInOrg(db);
    // Second org with no membership — should not appear.
    await seedOrg(db);

    const res = await server.inject({
      method: "GET",
      url: `/internal/users/${encodeURIComponent(user.clerkUserId)}/orgs`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.orgs).toHaveLength(1);
    expect(body.orgs[0]).toMatchObject({
      id: org.id,
      clerkOrgId: org.clerkOrgId,
      slug: org.slug,
      role: "member",
    });
  });

  test("user with no orgs → empty array", async () => {
    const db = await getIntegrationDb();
    const user = await seedUser(db);

    const res = await server.inject({
      method: "GET",
      url: `/internal/users/${encodeURIComponent(user.clerkUserId)}/orgs`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().orgs).toEqual([]);
  });
});

describe("GET /internal/users/:clerkUserId/orgs/:orgId (integration, A21)", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    await getIntegrationDb();
    server = await buildServer();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    await closeIntegrationDb();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  test("member → 200", async () => {
    const db = await getIntegrationDb();
    const { org, user } = await seedUserInOrg(db);

    const res = await server.inject({
      method: "GET",
      url: `/internal/users/${encodeURIComponent(user.clerkUserId)}/orgs/${org.id}`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });

    expect(res.statusCode).toBe(200);
  });

  test("non-member → 404", async () => {
    const db = await getIntegrationDb();
    const { user } = await seedUserInOrg(db);
    const otherOrg = await seedOrg(db);

    const res = await server.inject({
      method: "GET",
      url: `/internal/users/${encodeURIComponent(user.clerkUserId)}/orgs/${otherOrg.id}`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });

    expect(res.statusCode).toBe(404);
  });
});
