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
import { buildAssetR2Key } from "../../services/upload.service.js";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  getOrganizationMembershipList: vi.fn(),
  publishR2Cleanup: vi.fn(async () => {}),
}));

vi.mock("@clerk/backend", () => ({
  verifyToken: mocks.verifyToken,
  createClerkClient: () => ({
    users: { getOrganizationMembershipList: mocks.getOrganizationMembershipList },
  }),
}));

// Stub the publish helper — same rationale as in the annotation delete test.
// We want to assert the cleanup was queued with all asset keys for every
// annotation under the project, without going through the real Inngest SDK.
vi.mock("../../inngest/publish.js", () => ({
  publishR2Cleanup: mocks.publishR2Cleanup,
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

interface SeededProject {
  orgClerkId: string;
  userClerkId: string;
  userId: string;
  projectId: string;
  branchId: string;
  annotationId: string;
  annotationAssetId: string;
}

async function seedProjectWithChildren(args: {
  role: "admin" | "editor" | "viewer";
}): Promise<SeededProject> {
  const db = await getIntegrationDb();
  const org = await seedOrg(db);
  const user = await seedUser(db);
  const slug = `proj-${Math.random().toString(36).slice(2, 10)}`;
  const [project] = await db
    .insert(schema.projects)
    .values({
      orgId: org.id,
      creatorUserId: user.id,
      name: "Doomed Project",
      slug,
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
  const [annotation] = await db
    .insert(schema.annotations)
    .values({
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
      targetType: "element",
      url: "https://example.com",
      targetSelector: "body > main",
      viewport: { width: 1280, height: 720, dpr: 1 },
      commentText: "Doomed comment",
    })
    .returning();
  if (!annotation) throw new Error("annotation insert returned no rows");
  const assetId = randomUUID();
  await db.insert(schema.annotationAssets).values({
    id: assetId,
    annotationId: annotation.id,
    kind: "screenshot",
    r2Key: buildAssetR2Key({ projectId: project.id, kind: "screenshot", assetId }),
    contentType: "image/png",
    sizeBytes: 12,
  });
  await db.insert(schema.annotationEvents).values({
    annotationId: annotation.id,
    actorType: "user",
    actorId: user.id,
    type: "created",
    payload: {},
  });

  return {
    orgClerkId: org.clerkOrgId,
    userClerkId: user.clerkUserId,
    userId: user.id,
    projectId: project.id,
    branchId: branch.id,
    annotationId: annotation.id,
    annotationAssetId: assetId,
  };
}

describe("DELETE /projects/:projectId (integration)", () => {
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

  test("project admin → 204, project + members + branches + annotations cascade-deleted", async () => {
    const seeded = await seedProjectWithChildren({ role: "admin" });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:admin" }],
    });

    const res = await server.inject({
      method: "DELETE",
      url: `/projects/${seeded.projectId}`,
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(204);

    const db = await getIntegrationDb();
    const projects = await db.query.projects.findMany({
      where: eq(schema.projects.id, seeded.projectId),
    });
    expect(projects).toHaveLength(0);
    const members = await db.query.projectMembers.findMany({
      where: eq(schema.projectMembers.projectId, seeded.projectId),
    });
    expect(members).toHaveLength(0);
    const branches = await db.query.branches.findMany({
      where: eq(schema.branches.projectId, seeded.projectId),
    });
    expect(branches).toHaveLength(0);
    const annotations = await db.query.annotations.findMany({
      where: eq(schema.annotations.id, seeded.annotationId),
    });
    expect(annotations).toHaveLength(0);
    const events = await db.query.annotationEvents.findMany({
      where: eq(schema.annotationEvents.annotationId, seeded.annotationId),
    });
    expect(events).toHaveLength(0);
    const assets = await db.query.annotationAssets.findMany({
      where: eq(schema.annotationAssets.annotationId, seeded.annotationId),
    });
    expect(assets).toHaveLength(0);

    // R2 cleanup: every asset under the project must have its key queued.
    expect(mocks.publishR2Cleanup).toHaveBeenCalledTimes(1);
    const [, keys, origin] = mocks.publishR2Cleanup.mock.calls[0] as [unknown, string[], string];
    expect(origin).toBe(`project:${seeded.projectId}`);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(new RegExp(`^projects/${seeded.projectId}/screenshot/`));
  });

  test("project editor → 403 FORBIDDEN, project still present", async () => {
    const seeded = await seedProjectWithChildren({ role: "editor" });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "DELETE",
      url: `/projects/${seeded.projectId}`,
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");

    const db = await getIntegrationDb();
    const projects = await db.query.projects.findMany({
      where: eq(schema.projects.id, seeded.projectId),
    });
    expect(projects).toHaveLength(1);
  });

  test("project viewer → 403 FORBIDDEN", async () => {
    const seeded = await seedProjectWithChildren({ role: "viewer" });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "DELETE",
      url: `/projects/${seeded.projectId}`,
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  test("non-member → 404 NOT_FOUND, project still present", async () => {
    const seeded = await seedProjectWithChildren({ role: "admin" });
    const db = await getIntegrationDb();
    const otherOrg = await seedOrg(db);
    const outsider = await seedUser(db);
    mockAuth({
      clerkUserId: outsider.clerkUserId,
      memberships: [{ clerkOrgId: otherOrg.clerkOrgId, role: "org:admin" }],
    });

    const res = await server.inject({
      method: "DELETE",
      url: `/projects/${seeded.projectId}`,
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");

    const projects = await db.query.projects.findMany({
      where: eq(schema.projects.id, seeded.projectId),
    });
    expect(projects).toHaveLength(1);
  });
});
