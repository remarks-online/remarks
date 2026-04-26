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

// /internal/* never reaches Clerk, but buildServer still registers the Clerk
// plugin and the authenticated scope; mocking the SDK keeps `createClerkClient`
// from doing anything network-y at boot.
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

// Seeds a user, an org, two projects in that org, and makes the user a member
// of project A only. The whoami endpoint should return only project A.
async function seedUserWithProjects(db: Db) {
  const org = await seedOrg(db);
  const user = await seedUser(db);
  const [projectA] = await db
    .insert(schema.projects)
    .values({
      orgId: org.id,
      name: `Project A ${rand()}`,
      slug: `proj-a-${rand()}`,
      primaryBranch: "main",
    })
    .returning();
  const [projectB] = await db
    .insert(schema.projects)
    .values({
      orgId: org.id,
      name: `Project B ${rand()}`,
      slug: `proj-b-${rand()}`,
      primaryBranch: "main",
    })
    .returning();
  if (!projectA || !projectB) throw new Error("project insert returned no rows");
  await db
    .insert(schema.projectMembers)
    .values({ projectId: projectA.id, userId: user.id, role: "editor" });
  return { org, user, projectA, projectB };
}

describe("GET /internal/mcp/whoami/:clerkUserId (integration, ADR-0015)", () => {
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

  test("known clerkUserId → 200 with user + accessible projects only", async () => {
    const db = await getIntegrationDb();
    const { user, projectA } = await seedUserWithProjects(db);

    const res = await server.inject({
      method: "GET",
      url: `/internal/mcp/whoami/${encodeURIComponent(user.clerkUserId)}`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toEqual({ id: user.id, email: user.email, name: user.name });
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0]).toEqual({
      id: projectA.id,
      name: projectA.name,
      slug: projectA.slug,
    });
  });

  test("user with no project memberships → 200 with empty projects array", async () => {
    const db = await getIntegrationDb();
    const user = await seedUser(db);

    const res = await server.inject({
      method: "GET",
      url: `/internal/mcp/whoami/${encodeURIComponent(user.clerkUserId)}`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().projects).toEqual([]);
  });

  test("unknown clerkUserId → 404 NOT_FOUND", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/internal/mcp/whoami/user_does_not_exist",
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  test("missing x-internal-auth → 401 UNAUTHORIZED", async () => {
    const db = await getIntegrationDb();
    const { user } = await seedUserWithProjects(db);

    const res = await server.inject({
      method: "GET",
      url: `/internal/mcp/whoami/${encodeURIComponent(user.clerkUserId)}`,
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});
