import { schema } from "@remarks/db";
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
}));

vi.mock("@clerk/backend", () => ({
  verifyToken: mocks.verifyToken,
  createClerkClient: () => ({
    users: { getOrganizationMembershipList: mocks.getOrganizationMembershipList },
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
      organization: { id: m.clerkOrgId },
    })),
  });
}

interface SeededProject {
  orgClerkId: string;
  userClerkId: string;
  userId: string;
  projectId: string;
}

async function seedProjectWithMember(args: {
  role: "admin" | "editor" | "viewer";
}): Promise<SeededProject> {
  const db = await getIntegrationDb();
  const org = await seedOrg(db);
  const user = await seedUser(db);
  const [project] = await db
    .insert(schema.projects)
    .values({
      orgId: org.id,
      name: "Test Project",
      slug: `proj-${Math.random().toString(36).slice(2, 10)}`,
      gitRepoUrl: null,
      primaryBranch: "main",
    })
    .returning();
  if (!project) throw new Error("project insert returned no rows");
  await db.insert(schema.projectMembers).values({
    projectId: project.id,
    userId: user.id,
    role: args.role,
  });
  return {
    orgClerkId: org.clerkOrgId,
    userClerkId: user.clerkUserId,
    userId: user.id,
    projectId: project.id,
  };
}

function listUrl(input: Record<string, unknown>): string {
  return `/trpc/annotations.list?input=${encodeURIComponent(JSON.stringify(input))}`;
}

describe("tRPC annotations.list (integration)", () => {
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

  test("member of project → 200, returns items with resolved branchName", async () => {
    const { orgClerkId, userClerkId, userId, projectId } = await seedProjectWithMember({
      role: "viewer",
    });
    const db = await getIntegrationDb();

    const [main] = await db.insert(schema.branches).values({ projectId, name: "main" }).returning();
    const [feature] = await db
      .insert(schema.branches)
      .values({ projectId, name: "feature/x" })
      .returning();
    if (!main || !feature) throw new Error("branch seed failed");

    const base = new Date("2026-01-01T00:00:00.000Z").getTime();
    await db.insert(schema.annotations).values([
      {
        projectId,
        branchId: main.id,
        authorId: userId,
        targetType: "element",
        url: "https://acme.com/a",
        targetSelector: "#a",
        viewport: { width: 1920, height: 1080, dpr: 2 },
        commentText: "On main",
        createdAt: new Date(base + 2000),
        updatedAt: new Date(base + 2000),
      },
      {
        projectId,
        branchId: feature.id,
        authorId: userId,
        targetType: "element",
        url: "https://acme.com/b",
        targetSelector: "#b",
        viewport: { width: 1920, height: 1080, dpr: 2 },
        commentText: "On feature",
        createdAt: new Date(base + 1000),
        updatedAt: new Date(base + 1000),
      },
    ]);

    mockAuth({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });
    const res = await server.inject({
      method: "GET",
      url: listUrl({ projectId, limit: 50 }),
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json().result.data;
    expect(body.items).toHaveLength(2);
    expect(body.items[0].branchName).toBe("main");
    expect(body.items[0].commentText).toBe("On main");
    expect(body.items[1].branchName).toBe("feature/x");
    expect(body.items[1].commentText).toBe("On feature");
  });

  test("non-member of project → NOT_FOUND (404), doesn't leak existence", async () => {
    const { projectId } = await seedProjectWithMember({ role: "viewer" });

    const outsider = await seedUser(await getIntegrationDb(), { clerkUserId: "user_anno_out" });
    mockAuth({ clerkUserId: outsider.clerkUserId, memberships: [] });

    const res = await server.inject({
      method: "GET",
      url: listUrl({ projectId, limit: 50 }),
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.data.code).toBe("NOT_FOUND");
  });

  test("branch filter passes through — missing branch returns empty page", async () => {
    const { orgClerkId, userClerkId, projectId } = await seedProjectWithMember({
      role: "viewer",
    });

    mockAuth({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });
    const res = await server.inject({
      method: "GET",
      url: listUrl({ projectId, branch: "no-such-branch", limit: 50 }),
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json().result.data;
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  test("status filter passes through", async () => {
    const { orgClerkId, userClerkId, userId, projectId } = await seedProjectWithMember({
      role: "viewer",
    });
    const db = await getIntegrationDb();

    const [main] = await db.insert(schema.branches).values({ projectId, name: "main" }).returning();
    if (!main) throw new Error("branch seed failed");

    await db.insert(schema.annotations).values([
      {
        projectId,
        branchId: main.id,
        authorId: userId,
        status: "to_do",
        targetType: "element",
        url: "https://acme.com/a",
        targetSelector: "#a",
        viewport: { width: 1920, height: 1080, dpr: 2 },
        commentText: "todo",
      },
      {
        projectId,
        branchId: main.id,
        authorId: userId,
        status: "done",
        targetType: "element",
        url: "https://acme.com/b",
        targetSelector: "#b",
        viewport: { width: 1920, height: 1080, dpr: 2 },
        commentText: "done",
      },
    ]);

    mockAuth({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });
    const res = await server.inject({
      method: "GET",
      url: listUrl({ projectId, status: "done", limit: 50 }),
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json().result.data;
    expect(body.items).toHaveLength(1);
    expect(body.items[0].status).toBe("done");
    expect(body.items[0].commentText).toBe("done");
  });

  test("missing Authorization → 401 UNAUTHORIZED", async () => {
    const { projectId } = await seedProjectWithMember({ role: "viewer" });
    const res = await server.inject({
      method: "GET",
      url: listUrl({ projectId, limit: 50 }),
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});
