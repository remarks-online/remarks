import { randomUUID } from "node:crypto";
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
      organization: { id: m.clerkOrgId },
    })),
  });
}

interface SeededAnnotation {
  orgClerkId: string;
  userClerkId: string;
  userId: string;
  projectId: string;
  annotationId: string;
}

async function seedAnnotationWithEvents(
  role: "viewer" | "editor" = "viewer"
): Promise<SeededAnnotation & { eventIds: string[] }> {
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
    role,
  });
  const [branch] = await db
    .insert(schema.branches)
    .values({ projectId: project.id, name: "main" })
    .returning();
  if (!branch) throw new Error("branch insert returned no rows");
  const [annotation] = await db
    .insert(schema.annotations)
    .values({
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
      targetType: "route",
      url: "https://staging.acme.com/",
      viewport: { width: 1440, height: 900, dpr: 2 },
      commentText: "Initial",
    })
    .returning();
  if (!annotation) throw new Error("annotation insert returned no rows");

  const base = Date.now();
  const eventRows = await db
    .insert(schema.annotationEvents)
    .values([
      {
        annotationId: annotation.id,
        actorType: "user",
        actorId: user.id,
        type: "created",
        payload: {},
        createdAt: new Date(base),
      },
      {
        annotationId: annotation.id,
        actorType: "user",
        actorId: user.id,
        type: "status_changed",
        payload: { from: "to_do", to: "doing" },
        createdAt: new Date(base + 1000),
      },
    ])
    .returning({ id: schema.annotationEvents.id });

  return {
    orgClerkId: org.clerkOrgId,
    userClerkId: user.clerkUserId,
    userId: user.id,
    projectId: project.id,
    annotationId: annotation.id,
    eventIds: eventRows.map((e) => e.id),
  };
}

describe("GET /annotations/:annotationId/events (integration)", () => {
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

  test("project member → 200 with events in ascending order, user actor hydrated", async () => {
    const seeded = await seedAnnotationWithEvents();
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "GET",
      url: `/annotations/${seeded.annotationId}/events`,
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events).toHaveLength(2);
    expect(body.events[0]).toMatchObject({
      annotationId: seeded.annotationId,
      type: "created",
      actorType: "user",
      payload: {},
    });
    expect(body.events[0].actor).toMatchObject({ id: seeded.userId });
    expect(body.events[1]).toMatchObject({
      type: "status_changed",
      actorType: "user",
      payload: { from: "to_do", to: "doing" },
    });
  });

  test("unknown annotation → 404 NOT_FOUND", async () => {
    const seeded = await seedAnnotationWithEvents();
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "GET",
      url: `/annotations/${randomUUID()}/events`,
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  test("non-member → 404 (project existence not leaked)", async () => {
    const seeded = await seedAnnotationWithEvents();
    const db = await getIntegrationDb();
    const outsiderOrg = await seedOrg(db);
    const outsider = await seedUser(db);
    mockAuth({
      clerkUserId: outsider.clerkUserId,
      memberships: [{ clerkOrgId: outsiderOrg.clerkOrgId, role: "org:admin" }],
    });

    const res = await server.inject({
      method: "GET",
      url: `/annotations/${seeded.annotationId}/events`,
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  test("unauthenticated → 401 UNAUTHORIZED", async () => {
    const seeded = await seedAnnotationWithEvents();
    const res = await server.inject({
      method: "GET",
      url: `/annotations/${seeded.annotationId}/events`,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  test("invalid uuid → 400 VALIDATION_ERROR", async () => {
    const seeded = await seedAnnotationWithEvents();
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "GET",
      url: "/annotations/not-a-uuid/events",
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});
