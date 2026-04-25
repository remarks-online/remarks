import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  closeIntegrationDb,
  getIntegrationDb,
  seedOrg,
  seedUser,
  truncateAll,
} from "../../test/integration/db.js";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  getOrganizationMembershipList: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@clerk/backend", () => ({
  verifyToken: mocks.verifyToken,
  createClerkClient: () => ({
    users: {
      getOrganizationMembershipList: mocks.getOrganizationMembershipList,
      getUser: mocks.getUser,
    },
  }),
}));

const { buildServer } = await import("../server.js");

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

describe("tRPC me.getCurrentUser (integration)", () => {
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

  test("authenticated user with memberships → 200, returns user + orgs", async () => {
    const db = await getIntegrationDb();
    const orgA = await seedOrg(db, { clerkOrgId: "org_me_a" });
    const orgB = await seedOrg(db, { clerkOrgId: "org_me_b" });
    const user = await seedUser(db, {
      clerkUserId: "user_me_happy",
      email: "me@example.com",
      name: "Me Person",
      avatarUrl: "https://img.example.com/me.png",
    });
    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [
        { clerkOrgId: orgA.clerkOrgId, role: "org:admin" },
        { clerkOrgId: orgB.clerkOrgId, role: "org:member" },
      ],
    });

    const res = await server.inject({
      method: "GET",
      url: "/trpc/me.getCurrentUser",
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // tRPC wraps query results in { result: { data: ... } }
    expect(body.result.data).toEqual({
      user: {
        id: user.id,
        clerkUserId: "user_me_happy",
        email: "me@example.com",
        name: "Me Person",
        avatarUrl: "https://img.example.com/me.png",
      },
      orgMemberships: [
        { clerkOrgId: orgA.clerkOrgId, role: "org:admin" },
        { clerkOrgId: orgB.clerkOrgId, role: "org:member" },
      ],
    });
  });

  test("user with no orgs → 200, empty memberships array", async () => {
    const db = await getIntegrationDb();
    const user = await seedUser(db, { clerkUserId: "user_me_solo" });
    mockAuth({ clerkUserId: user.clerkUserId, memberships: [] });

    const res = await server.inject({
      method: "GET",
      url: "/trpc/me.getCurrentUser",
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().result.data.orgMemberships).toEqual([]);
  });

  test("missing Authorization → 401 UNAUTHORIZED", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/trpc/me.getCurrentUser",
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  test("user missing from db but present in Clerk → lazy-provisioned, 200", async () => {
    mocks.verifyToken.mockResolvedValueOnce({ sub: "user_lazy_provisioned" });
    mocks.getUser.mockResolvedValueOnce({
      id: "user_lazy_provisioned",
      emailAddresses: [{ id: "idn_1", emailAddress: "lazy@example.com" }],
      primaryEmailAddressId: "idn_1",
      firstName: "Lazy",
      lastName: "User",
      imageUrl: "https://img.example.com/lazy.png",
    });
    mocks.getOrganizationMembershipList.mockResolvedValueOnce({ data: [] });

    const res = await server.inject({
      method: "GET",
      url: "/trpc/me.getCurrentUser",
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().result.data.user).toMatchObject({
      clerkUserId: "user_lazy_provisioned",
      email: "lazy@example.com",
      name: "Lazy User",
    });
  });

  test("user missing from db AND Clerk getUser fails → 401 UNAUTHORIZED", async () => {
    mocks.verifyToken.mockResolvedValueOnce({ sub: "user_does_not_exist" });
    mocks.getUser.mockRejectedValueOnce(new Error("Clerk user not found"));

    const res = await server.inject({
      method: "GET",
      url: "/trpc/me.getCurrentUser",
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});
