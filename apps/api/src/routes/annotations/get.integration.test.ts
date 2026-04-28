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
import { ensureBucket, readR2EnvOrThrow } from "../../../test/integration/r2.js";
import { type R2Client, createR2Client, putObject } from "../../lib/r2.js";
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
  assetId: string;
}

async function seedAnnotation(args: {
  role: "admin" | "editor" | "viewer";
  withScreenshot?: boolean;
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
  const [annotation] = await db
    .insert(schema.annotations)
    .values({
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
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
    actorId: user.id,
    type: "created",
    payload: {},
  });

  let assetId = "";
  if (args.withScreenshot) {
    assetId = randomUUID();
    const key = buildAssetR2Key({ projectId: project.id, kind: "screenshot", assetId });
    // Seed the row but don't put bytes — presigned URL generation does not
    // require the object to exist; the test asserts the URL shape, not bytes.
    await db.insert(schema.annotationAssets).values({
      id: assetId,
      annotationId: annotation.id,
      kind: "screenshot",
      r2Key: key,
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
    assetId,
  };
}

describe("GET /annotations/:annotationId (integration)", () => {
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

  test("project member with screenshot → 200 with full response shape and presigned URL", async () => {
    const seeded = await seedAnnotation({ role: "viewer", withScreenshot: true });
    // Put real bytes so the URL is fetchable end-to-end.
    const payload = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
    const key = buildAssetR2Key({
      projectId: seeded.projectId,
      kind: "screenshot",
      assetId: seeded.assetId,
    });
    await putObject(r2, { key, body: payload, contentType: "image/png" });

    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "GET",
      url: `/annotations/${seeded.annotationId}`,
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      id: seeded.annotationId,
      projectId: seeded.projectId,
      branchName: "main",
      status: "to_do",
      targetType: "element",
      url: "https://staging.acme.com/checkout",
      commentText: "Original comment",
    });
    expect(body.author).toMatchObject({ id: seeded.userId });
    expect(body.assets).toHaveLength(1);
    expect(body.assets[0]).toMatchObject({
      id: seeded.assetId,
      kind: "screenshot",
      contentType: "image/png",
    });
    expect(typeof body.assets[0].url).toBe("string");

    const getRes = await fetch(body.assets[0].url);
    expect(getRes.ok).toBe(true);
  });

  test("missing annotation → 404 NOT_FOUND", async () => {
    const seeded = await seedAnnotation({ role: "viewer" });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "GET",
      url: `/annotations/${randomUUID()}`,
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  test("non-member of annotation's project → 404 NOT_FOUND (project existence not leaked)", async () => {
    const seeded = await seedAnnotation({ role: "viewer" });
    // Outsider belongs to a different org with no project membership.
    const db = await getIntegrationDb();
    const outsiderOrg = await seedOrg(db);
    const outsider = await seedUser(db);
    mockAuth({
      clerkUserId: outsider.clerkUserId,
      memberships: [{ clerkOrgId: outsiderOrg.clerkOrgId, role: "org:admin" }],
    });

    const res = await server.inject({
      method: "GET",
      url: `/annotations/${seeded.annotationId}`,
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  test("unauthenticated → 401 UNAUTHORIZED", async () => {
    const seeded = await seedAnnotation({ role: "viewer" });
    const res = await server.inject({
      method: "GET",
      url: `/annotations/${seeded.annotationId}`,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  test("invalid uuid in path → 400 VALIDATION_ERROR", async () => {
    const seeded = await seedAnnotation({ role: "viewer" });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "GET",
      url: "/annotations/not-a-uuid",
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});
