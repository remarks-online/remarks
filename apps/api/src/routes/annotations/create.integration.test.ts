import { randomUUID } from "node:crypto";
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

describe("POST /projects/:projectId/annotations (integration)", () => {
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

  async function seedProjectWithMember(args: {
    role: "admin" | "editor" | "viewer";
  }): Promise<{
    orgClerkId: string;
    userClerkId: string;
    userId: string;
    projectId: string;
  }> {
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

  function baseAnnotationPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      branch: "feature/lazy",
      targetType: "element",
      url: "https://staging.acme.com/checkout",
      targetSelector: "body > main > button.submit",
      viewport: { width: 1920, height: 1080, dpr: 2 },
      commentText: "This button should use our brand green",
      ...overrides,
    };
  }

  test("editor with screenshot → 201, annotation + asset + event written", async () => {
    const { orgClerkId, userClerkId, userId, projectId } = await seedProjectWithMember({
      role: "editor",
    });

    // Simulate the presign→PUT flow: upload bytes to R2 at a known key. The
    // assetId here mirrors what presign would have returned.
    const assetId = randomUUID();
    const payload = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
    const key = buildAssetR2Key({ projectId, kind: "screenshot", assetId });
    await putObject(r2, { key, body: payload, contentType: "image/png" });

    mockAuth({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "POST",
      url: `/projects/${projectId}/annotations`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: baseAnnotationPayload({ screenshotAssetId: assetId }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      projectId,
      branchName: "feature/lazy",
      status: "to_do",
      targetType: "element",
      url: "https://staging.acme.com/checkout",
      targetSelector: "body > main > button.submit",
      targetCoords: null,
      viewport: { width: 1920, height: 1080, dpr: 2 },
      commentText: "This button should use our brand green",
    });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.branchId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.author).toMatchObject({ id: userId });
    expect(body.assets).toHaveLength(1);
    expect(body.assets[0]).toMatchObject({
      id: assetId,
      kind: "screenshot",
      contentType: "image/png",
    });
    expect(typeof body.assets[0].url).toBe("string");
    expect(body.assets[0].url).toContain("http");

    // Presigned URL round-trips bytes.
    const getRes = await fetch(body.assets[0].url);
    expect(getRes.ok).toBe(true);
    const got = new Uint8Array(await getRes.arrayBuffer());
    expect(Buffer.from(got)).toEqual(Buffer.from(payload));

    // DB state: one branch, one annotation, one asset, one event.
    const db = await getIntegrationDb();
    const branches = await db.query.branches.findMany({
      where: eq(schema.branches.projectId, projectId),
    });
    expect(branches).toHaveLength(1);
    expect(branches[0]?.name).toBe("feature/lazy");
    expect(branches[0]?.id).toBe(body.branchId);

    const annotations = await db.query.annotations.findMany({
      where: eq(schema.annotations.projectId, projectId),
    });
    expect(annotations).toHaveLength(1);
    expect(annotations[0]?.authorId).toBe(userId);

    const assets = await db.query.annotationAssets.findMany({
      where: eq(schema.annotationAssets.annotationId, body.id),
    });
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      id: assetId,
      kind: "screenshot",
      contentType: "image/png",
      sizeBytes: payload.byteLength,
    });

    const events = await db.query.annotationEvents.findMany({
      where: eq(schema.annotationEvents.annotationId, body.id),
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "created",
      actorType: "user",
      actorId: userId,
    });
  });

  test("branch already exists → reuses existing branch row", async () => {
    const { orgClerkId, userClerkId, projectId } = await seedProjectWithMember({
      role: "editor",
    });
    const db = await getIntegrationDb();
    const [preseeded] = await db
      .insert(schema.branches)
      .values({ projectId, name: "main" })
      .returning();
    if (!preseeded) throw new Error("branch seed returned no rows");

    mockAuth({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "POST",
      url: `/projects/${projectId}/annotations`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: baseAnnotationPayload({ branch: "main" }),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().branchId).toBe(preseeded.id);

    const branchRows = await db.query.branches.findMany({
      where: and(eq(schema.branches.projectId, projectId), eq(schema.branches.name, "main")),
    });
    expect(branchRows).toHaveLength(1);
  });

  test("branch missing → lazy-created exactly once", async () => {
    const { orgClerkId, userClerkId, projectId } = await seedProjectWithMember({
      role: "editor",
    });
    mockAuth({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "POST",
      url: `/projects/${projectId}/annotations`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: baseAnnotationPayload({ branch: "feature/brand-new" }),
    });

    expect(res.statusCode).toBe(201);

    const db = await getIntegrationDb();
    const branchRows = await db.query.branches.findMany({
      where: and(
        eq(schema.branches.projectId, projectId),
        eq(schema.branches.name, "feature/brand-new")
      ),
    });
    expect(branchRows).toHaveLength(1);
    expect(branchRows[0]?.id).toBe(res.json().branchId);
  });

  test("viewer → 403 FORBIDDEN", async () => {
    const { orgClerkId, userClerkId, projectId } = await seedProjectWithMember({
      role: "viewer",
    });
    mockAuth({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "POST",
      url: `/projects/${projectId}/annotations`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: baseAnnotationPayload(),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  test("user from a different org → 404 NOT_FOUND (project existence not leaked)", async () => {
    // Post-1.33 the auth-plugin backstop fans out project_members rows for
    // every project in the caller's Clerk orgs, so the existence-leak guard
    // is only exercised when the caller has no Clerk overlap with the org.
    const db = await getIntegrationDb();
    const org = await seedOrg(db);
    const otherOrg = await seedOrg(db, { clerkOrgId: "org_anno_create_other" });
    const [project] = await db
      .insert(schema.projects)
      .values({
        orgId: org.id,
        name: "Target",
        slug: `proj-${Math.random().toString(36).slice(2, 10)}`,
        gitRepoUrl: null,
        primaryBranch: "main",
      })
      .returning();
    if (!project) throw new Error("project insert returned no rows");
    const outsider = await seedUser(db);
    mockAuth({
      clerkUserId: outsider.clerkUserId,
      memberships: [{ clerkOrgId: otherOrg.clerkOrgId, role: "org:admin" }],
    });

    const res = await server.inject({
      method: "POST",
      url: `/projects/${project.id}/annotations`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: baseAnnotationPayload(),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  test("element targetType without targetSelector → 400 VALIDATION_ERROR", async () => {
    const { orgClerkId, userClerkId, projectId } = await seedProjectWithMember({
      role: "editor",
    });
    mockAuth({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "POST",
      url: `/projects/${projectId}/annotations`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: baseAnnotationPayload({ targetSelector: undefined }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(res.json().error.issues)).toBe(true);
  });

  test("screenshotAssetId with no uploaded object → 400 VALIDATION_ERROR", async () => {
    const { orgClerkId, userClerkId, projectId } = await seedProjectWithMember({
      role: "editor",
    });
    mockAuth({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "POST",
      url: `/projects/${projectId}/annotations`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: baseAnnotationPayload({ screenshotAssetId: randomUUID() }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");

    // No annotation row should have been written.
    const db = await getIntegrationDb();
    const annotations = await db.query.annotations.findMany({
      where: eq(schema.annotations.projectId, projectId),
    });
    expect(annotations).toHaveLength(0);
  });
});
