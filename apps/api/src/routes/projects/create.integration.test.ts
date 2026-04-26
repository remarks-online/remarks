import { schema } from "@remarks/db";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  closeIntegrationDb,
  getIntegrationDb,
  seedOrg,
  seedUser,
  truncateAll,
} from "../../../test/integration/db.js";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  getOrganizationMembershipList: vi.fn(),
}));

vi.mock("@clerk/backend", () => ({
  verifyToken: mocks.verifyToken,
  createClerkClient: () => ({
    users: { getOrganizationMembershipList: mocks.getOrganizationMembershipList },
  }),
}));

const { buildServer } = await import("../../server.js");

const BEARER = "Bearer test.token.value";

function mockAuth(args: {
  clerkUserId: string;
  memberships: Array<{ clerkOrgId: string; role: "org:admin" | "org:member" }>;
}): void {
  mocks.verifyToken.mockResolvedValueOnce({ sub: args.clerkUserId });
  mocks.getOrganizationMembershipList.mockResolvedValueOnce({
    data: args.memberships.map((m) => ({
      role: m.role,
      organization: { id: m.clerkOrgId, name: m.clerkOrgId, slug: m.clerkOrgId },
    })),
  });
}

describe("POST /orgs/:orgId/projects (integration)", () => {
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
    for (const fn of Object.values(mocks)) fn.mockReset();
    await truncateAll();
  });

  test("org admin → 201, project row and creator membership both inserted", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_admin_happy" });
    const user = await seedUser(db, { clerkUserId: "user_admin" });
    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:admin" }],
    });

    const res = await server.inject({
      method: "POST",
      url: `/orgs/${org.clerkOrgId}/projects`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { name: "Acme Web", slug: "acme-web" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      orgId: org.id,
      name: "Acme Web",
      slug: "acme-web",
      gitRepoUrl: null,
      primaryBranch: "main",
    });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);

    const projectRow = await db.query.projects.findFirst({
      where: eq(schema.projects.id, body.id),
    });
    expect(projectRow?.orgId).toBe(org.id);
    expect(projectRow?.slug).toBe("acme-web");

    const memberRow = await db.query.projectMembers.findFirst({
      where: and(
        eq(schema.projectMembers.projectId, body.id),
        eq(schema.projectMembers.userId, user.id)
      ),
    });
    expect(memberRow?.role).toBe("admin");
  });

  test("non-member of org → 403 FORBIDDEN, no project inserted", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_target" });
    const otherOrg = await seedOrg(db, { clerkOrgId: "org_other" });
    const user = await seedUser(db, { clerkUserId: "user_outsider" });
    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: otherOrg.clerkOrgId, role: "org:admin" }],
    });

    const res = await server.inject({
      method: "POST",
      url: `/orgs/${org.clerkOrgId}/projects`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { name: "Acme", slug: "acme" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");

    const rows = await db.query.projects.findMany({
      where: eq(schema.projects.orgId, org.id),
    });
    expect(rows).toHaveLength(0);
  });

  test("org member but not admin → 403 FORBIDDEN", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_plain_member" });
    const user = await seedUser(db, { clerkUserId: "user_plain" });
    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "POST",
      url: `/orgs/${org.clerkOrgId}/projects`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { name: "Acme", slug: "acme" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  test("duplicate slug in same org → 409 CONFLICT", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_dup" });
    const user = await seedUser(db, { clerkUserId: "user_dup_admin" });

    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:admin" }],
    });
    const first = await server.inject({
      method: "POST",
      url: `/orgs/${org.clerkOrgId}/projects`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { name: "Acme", slug: "acme" },
    });
    expect(first.statusCode).toBe(201);

    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:admin" }],
    });
    const second = await server.inject({
      method: "POST",
      url: `/orgs/${org.clerkOrgId}/projects`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { name: "Acme Two", slug: "acme" },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("CONFLICT");
  });

  test("invalid body → 400 VALIDATION_ERROR with issues", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_badbody" });
    const user = await seedUser(db, { clerkUserId: "user_badbody" });
    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:admin" }],
    });

    const res = await server.inject({
      method: "POST",
      url: `/orgs/${org.clerkOrgId}/projects`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { name: "Acme", slug: "NOT A SLUG" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(res.json().error.issues)).toBe(true);
  });
});
