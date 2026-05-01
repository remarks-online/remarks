import { randomUUID } from "node:crypto";
import { schema } from "@remarks/db";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  closeIntegrationDb,
  getIntegrationDb,
  seedOrg,
  seedUser,
  truncateAll,
} from "../../../test/integration/db.js";
import { ensureBucket, readR2EnvOrThrow } from "../../../test/integration/r2.js";
import { type R2Client, createR2Client } from "../../lib/r2.js";

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

interface SeededAnnotation {
  orgClerkId: string;
  userClerkId: string;
  userId: string;
  projectId: string;
  annotationId: string;
}

async function seedAnnotation(args: {
  role: "admin" | "editor" | "viewer";
  authorIsCurrentUser?: boolean;
}): Promise<SeededAnnotation> {
  const db = await getIntegrationDb();
  const org = await seedOrg(db);
  const user = await seedUser(db);
  const [project] = await db
    .insert(schema.projects)
    .values({
      orgId: org.id,
      creatorUserId: user.id,
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
  const [branch] = await db
    .insert(schema.branches)
    .values({ projectId: project.id, name: "main" })
    .returning();
  if (!branch) throw new Error("branch insert returned no rows");
  // If the test wants someone other than the current user as author, seed a
  // separate author user so the current user is not author.
  const authorId = args.authorIsCurrentUser === false ? (await seedUser(db)).id : user.id;
  const [annotation] = await db
    .insert(schema.annotations)
    .values({
      projectId: project.id,
      branchId: branch.id,
      authorId,
      targetType: "element",
      url: "https://staging.acme.com/checkout",
      targetSelector: "body > main > button.submit",
      viewport: { width: 1920, height: 1080, dpr: 2 },
      commentText: "Original comment",
    })
    .returning();
  if (!annotation) throw new Error("annotation insert returned no rows");
  await db.insert(schema.annotationEvents).values({
    annotationId: annotation.id,
    actorType: "user",
    actorId: authorId,
    type: "created",
    payload: {},
  });

  return {
    orgClerkId: org.clerkOrgId,
    userClerkId: user.clerkUserId,
    userId: user.id,
    projectId: project.id,
    annotationId: annotation.id,
  };
}

describe("PATCH /annotations/:annotationId (integration)", () => {
  let server: FastifyInstance;
  let r2: R2Client;

  beforeAll(async () => {
    r2 = createR2Client(readR2EnvOrThrow());
    await ensureBucket(r2);
    await getIntegrationDb();
    server = await buildServer();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    await closeIntegrationDb();
    r2.s3.destroy();
  });

  beforeEach(async () => {
    for (const fn of Object.values(mocks)) fn.mockReset();
    await truncateAll();
  });

  test("editor changes status → 200, status_changed event written, updatedAt advances", async () => {
    const seeded = await seedAnnotation({ role: "editor", authorIsCurrentUser: false });
    const db = await getIntegrationDb();
    const before = await db.query.annotations.findFirst({
      where: eq(schema.annotations.id, seeded.annotationId),
    });
    if (!before) throw new Error("seeded annotation missing");

    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "PATCH",
      url: `/annotations/${seeded.annotationId}`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { status: "doing" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ id: seeded.annotationId, status: "doing" });

    const events = await db.query.annotationEvents.findMany({
      where: eq(schema.annotationEvents.annotationId, seeded.annotationId),
    });
    const statusEvents = events.filter((e) => e.type === "status_changed");
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0]).toMatchObject({
      type: "status_changed",
      actorType: "user",
      actorId: seeded.userId,
      payload: { from: "to_do", to: "doing" },
    });

    const after = await db.query.annotations.findFirst({
      where: eq(schema.annotations.id, seeded.annotationId),
    });
    expect(after?.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  test("author (viewer role) changes commentText → 200, comment_edited event written", async () => {
    const seeded = await seedAnnotation({ role: "viewer", authorIsCurrentUser: true });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "PATCH",
      url: `/annotations/${seeded.annotationId}`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { commentText: "Updated comment text" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().commentText).toBe("Updated comment text");

    const db = await getIntegrationDb();
    const events = await db.query.annotationEvents.findMany({
      where: eq(schema.annotationEvents.annotationId, seeded.annotationId),
    });
    const commentEvents = events.filter((e) => e.type === "comment_edited");
    expect(commentEvents).toHaveLength(1);
    expect(commentEvents[0]?.payload).toMatchObject({
      previousLength: "Original comment".length,
    });
  });

  test("status + commentText in one call → both events emitted", async () => {
    const seeded = await seedAnnotation({ role: "editor", authorIsCurrentUser: true });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "PATCH",
      url: `/annotations/${seeded.annotationId}`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { status: "done", commentText: "Closed it" },
    });

    expect(res.statusCode).toBe(200);

    const db = await getIntegrationDb();
    const events = await db.query.annotationEvents.findMany({
      where: eq(schema.annotationEvents.annotationId, seeded.annotationId),
    });
    expect(events.filter((e) => e.type === "status_changed")).toHaveLength(1);
    expect(events.filter((e) => e.type === "comment_edited")).toHaveLength(1);
  });

  test("editor sets intent → 200, intent_changed event written, response carries new value", async () => {
    const seeded = await seedAnnotation({ role: "editor", authorIsCurrentUser: false });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "PATCH",
      url: `/annotations/${seeded.annotationId}`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { intent: "fix" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().intent).toBe("fix");

    const db = await getIntegrationDb();
    const events = await db.query.annotationEvents.findMany({
      where: eq(schema.annotationEvents.annotationId, seeded.annotationId),
    });
    const intentEvents = events.filter((e) => e.type === "intent_changed");
    expect(intentEvents).toHaveLength(1);
    expect(intentEvents[0]).toMatchObject({
      type: "intent_changed",
      actorType: "user",
      payload: { from: null, to: "fix" },
    });
  });

  test("editor sets severity then clears it back to null → two events, payload {from,to}", async () => {
    const seeded = await seedAnnotation({ role: "editor", authorIsCurrentUser: false });

    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });
    let res = await server.inject({
      method: "PATCH",
      url: `/annotations/${seeded.annotationId}`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { severity: "blocking" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().severity).toBe("blocking");

    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });
    res = await server.inject({
      method: "PATCH",
      url: `/annotations/${seeded.annotationId}`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { severity: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().severity).toBeNull();

    const db = await getIntegrationDb();
    const events = await db.query.annotationEvents.findMany({
      where: eq(schema.annotationEvents.annotationId, seeded.annotationId),
      orderBy: (events, { asc }) => [asc(events.createdAt), asc(events.id)],
    });
    const severityEvents = events.filter((e) => e.type === "severity_changed");
    expect(severityEvents).toHaveLength(2);
    expect(severityEvents[0]?.payload).toMatchObject({ from: null, to: "blocking" });
    expect(severityEvents[1]?.payload).toMatchObject({ from: "blocking", to: null });
  });

  test("intent + severity in one call → both events emitted", async () => {
    const seeded = await seedAnnotation({ role: "editor", authorIsCurrentUser: true });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "PATCH",
      url: `/annotations/${seeded.annotationId}`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { intent: "approve", severity: "suggestion" },
    });

    expect(res.statusCode).toBe(200);

    const db = await getIntegrationDb();
    const events = await db.query.annotationEvents.findMany({
      where: eq(schema.annotationEvents.annotationId, seeded.annotationId),
    });
    expect(events.filter((e) => e.type === "intent_changed")).toHaveLength(1);
    expect(events.filter((e) => e.type === "severity_changed")).toHaveLength(1);
  });

  test("empty body → 400 VALIDATION_ERROR", async () => {
    const seeded = await seedAnnotation({ role: "editor", authorIsCurrentUser: true });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "PATCH",
      url: `/annotations/${seeded.annotationId}`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  test("invalid status enum → 400 VALIDATION_ERROR", async () => {
    const seeded = await seedAnnotation({ role: "editor", authorIsCurrentUser: true });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "PATCH",
      url: `/annotations/${seeded.annotationId}`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { status: "approved" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  test("viewer who is not the author → 403 FORBIDDEN", async () => {
    const seeded = await seedAnnotation({ role: "viewer", authorIsCurrentUser: false });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "PATCH",
      url: `/annotations/${seeded.annotationId}`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { status: "doing" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  test("missing annotation → 404 NOT_FOUND", async () => {
    const seeded = await seedAnnotation({ role: "editor", authorIsCurrentUser: true });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "PATCH",
      url: `/annotations/${randomUUID()}`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { status: "doing" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  test("unauthenticated → 401 UNAUTHORIZED", async () => {
    const seeded = await seedAnnotation({ role: "editor", authorIsCurrentUser: true });
    const res = await server.inject({
      method: "PATCH",
      url: `/annotations/${seeded.annotationId}`,
      headers: { "content-type": "application/json" },
      payload: { status: "doing" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  // G4: rejection requires a reason in the payload, persisted on the
  // status_changed event so reviewers see *why* the task was dismissed.
  test("status: rejected without reason → 400 VALIDATION_ERROR", async () => {
    const seeded = await seedAnnotation({ role: "editor", authorIsCurrentUser: true });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "PATCH",
      url: `/annotations/${seeded.annotationId}`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { status: "rejected" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  test("status: rejected with too-short reason → 400 VALIDATION_ERROR", async () => {
    const seeded = await seedAnnotation({ role: "editor", authorIsCurrentUser: true });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "PATCH",
      url: `/annotations/${seeded.annotationId}`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { status: "rejected", reason: "nope" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  test("status: rejected with valid reason → 200, payload.reason persisted", async () => {
    const seeded = await seedAnnotation({ role: "editor", authorIsCurrentUser: true });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "PATCH",
      url: `/annotations/${seeded.annotationId}`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { status: "rejected", reason: "duplicate of an existing report" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: seeded.annotationId, status: "rejected" });

    const db = await getIntegrationDb();
    const events = await db.query.annotationEvents.findMany({
      where: eq(schema.annotationEvents.annotationId, seeded.annotationId),
    });
    const statusEvents = events.filter((e) => e.type === "status_changed");
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0]?.payload).toEqual({
      from: "to_do",
      to: "rejected",
      reason: "duplicate of an existing report",
    });
  });

  test("reason without status: rejected → 400 VALIDATION_ERROR", async () => {
    const seeded = await seedAnnotation({ role: "editor", authorIsCurrentUser: true });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "PATCH",
      url: `/annotations/${seeded.annotationId}`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { status: "doing", reason: "starting work on this task" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});
