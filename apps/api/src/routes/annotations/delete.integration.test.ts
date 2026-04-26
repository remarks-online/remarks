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
  withAsset?: boolean;
}): Promise<SeededAnnotation> {
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
  const [branch] = await db
    .insert(schema.branches)
    .values({ projectId: project.id, name: "main" })
    .returning();
  if (!branch) throw new Error("branch insert returned no rows");
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
      commentText: "Doomed comment",
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
  if (args.withAsset) {
    const assetId = randomUUID();
    await db.insert(schema.annotationAssets).values({
      id: assetId,
      annotationId: annotation.id,
      kind: "screenshot",
      r2Key: buildAssetR2Key({ projectId: project.id, kind: "screenshot", assetId }),
      contentType: "image/png",
      sizeBytes: 12,
    });
  }

  return {
    orgClerkId: org.clerkOrgId,
    userClerkId: user.clerkUserId,
    userId: user.id,
    projectId: project.id,
    annotationId: annotation.id,
  };
}

describe("DELETE /annotations/:annotationId (integration)", () => {
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

  test("project admin → 204, annotation + events + assets cascade-deleted", async () => {
    const seeded = await seedAnnotation({
      role: "admin",
      authorIsCurrentUser: false,
      withAsset: true,
    });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:admin" }],
    });

    const res = await server.inject({
      method: "DELETE",
      url: `/annotations/${seeded.annotationId}`,
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(204);

    const db = await getIntegrationDb();
    const remaining = await db.query.annotations.findMany({
      where: eq(schema.annotations.id, seeded.annotationId),
    });
    expect(remaining).toHaveLength(0);
    const events = await db.query.annotationEvents.findMany({
      where: eq(schema.annotationEvents.annotationId, seeded.annotationId),
    });
    expect(events).toHaveLength(0);
    const assets = await db.query.annotationAssets.findMany({
      where: eq(schema.annotationAssets.annotationId, seeded.annotationId),
    });
    expect(assets).toHaveLength(0);
  });

  test("author with viewer role → 204", async () => {
    const seeded = await seedAnnotation({ role: "viewer", authorIsCurrentUser: true });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "DELETE",
      url: `/annotations/${seeded.annotationId}`,
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(204);
    const db = await getIntegrationDb();
    const remaining = await db.query.annotations.findMany({
      where: eq(schema.annotations.id, seeded.annotationId),
    });
    expect(remaining).toHaveLength(0);
  });

  test("editor who is not the author → 403 FORBIDDEN", async () => {
    const seeded = await seedAnnotation({ role: "editor", authorIsCurrentUser: false });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "DELETE",
      url: `/annotations/${seeded.annotationId}`,
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");

    // Annotation must still exist after a forbidden delete attempt.
    const db = await getIntegrationDb();
    const remaining = await db.query.annotations.findMany({
      where: eq(schema.annotations.id, seeded.annotationId),
    });
    expect(remaining).toHaveLength(1);
  });

  test("missing annotation → 404 NOT_FOUND", async () => {
    const seeded = await seedAnnotation({ role: "admin", authorIsCurrentUser: true });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:admin" }],
    });

    const res = await server.inject({
      method: "DELETE",
      url: `/annotations/${randomUUID()}`,
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  test("unauthenticated → 401 UNAUTHORIZED", async () => {
    const seeded = await seedAnnotation({ role: "admin", authorIsCurrentUser: true });
    const res = await server.inject({
      method: "DELETE",
      url: `/annotations/${seeded.annotationId}`,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});
