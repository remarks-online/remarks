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
import { type R2Client, createR2Client, getObject } from "../../lib/r2.js";
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

describe("POST /uploads/presign (integration)", () => {
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
      projectId: project.id,
    };
  }

  test("editor → 201 and the signed URL round-trips bytes through R2", async () => {
    const { orgClerkId, userClerkId, projectId } = await seedProjectWithMember({
      role: "editor",
    });
    mockAuth({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });

    const payload = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const before = Date.now();

    const res = await server.inject({
      method: "POST",
      url: "/uploads/presign",
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: {
        projectId,
        kind: "screenshot",
        contentType: "image/png",
        sizeBytes: payload.byteLength,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.assetId).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof body.uploadUrl).toBe("string");
    expect(body.uploadUrl).toContain("http");
    // expiresAt should be ~300s in the future (±5s slack for test timing).
    const expiresAtMs = Date.parse(body.expiresAt);
    expect(expiresAtMs - before).toBeGreaterThan(295_000);
    expect(expiresAtMs - before).toBeLessThan(305_000);
    // fields is optional and unused for PUT-based uploads.
    expect(body.fields).toBeUndefined();

    const putRes = await fetch(body.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: payload,
    });
    expect(putRes.ok, `presigned PUT failed: ${putRes.status} ${await putRes.text()}`).toBe(true);

    const key = buildAssetR2Key({
      projectId,
      kind: "screenshot",
      assetId: body.assetId,
    });
    const got = await getObject(r2, { key });
    expect(Buffer.from(got.body)).toEqual(Buffer.from(payload));
    expect(got.contentType).toBe("image/png");
  });

  test("admin role also authorized → 201", async () => {
    const { orgClerkId, userClerkId, projectId } = await seedProjectWithMember({
      role: "admin",
    });
    mockAuth({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:admin" }],
    });

    const res = await server.inject({
      method: "POST",
      url: "/uploads/presign",
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: {
        projectId,
        kind: "screenshot",
        contentType: "image/png",
        sizeBytes: 1024,
      },
    });

    expect(res.statusCode).toBe(201);
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
      url: "/uploads/presign",
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: {
        projectId,
        kind: "screenshot",
        contentType: "image/png",
        sizeBytes: 1024,
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  test("user from a different org → 404 NOT_FOUND (project existence not leaked)", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db);
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
    // Truly external caller: not a Clerk member of the project's org. Post-1.33
    // org-member-not-project-member is impossible (auth backstop fans out
    // project_members rows for every org the caller belongs to), so the only
    // way to test the existence-leak guard is from outside the org entirely.
    const outsider = await seedUser(db);
    const otherOrg = await seedOrg(db, { clerkOrgId: "org_presign_outsider_other" });
    mockAuth({
      clerkUserId: outsider.clerkUserId,
      memberships: [{ clerkOrgId: otherOrg.clerkOrgId, role: "org:admin" }],
    });

    const res = await server.inject({
      method: "POST",
      url: "/uploads/presign",
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: {
        projectId: project.id,
        kind: "screenshot",
        contentType: "image/png",
        sizeBytes: 1024,
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  test("sizeBytes > 50 MB → 400 VALIDATION_ERROR with issues", async () => {
    const { orgClerkId, userClerkId, projectId } = await seedProjectWithMember({
      role: "editor",
    });
    mockAuth({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "POST",
      url: "/uploads/presign",
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: {
        projectId,
        kind: "screenshot",
        contentType: "image/png",
        sizeBytes: 60_000_000,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(res.json().error.issues)).toBe(true);
  });

  test("malformed contentType → 400 VALIDATION_ERROR", async () => {
    const { orgClerkId, userClerkId, projectId } = await seedProjectWithMember({
      role: "editor",
    });
    mockAuth({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "POST",
      url: "/uploads/presign",
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: {
        projectId,
        kind: "screenshot",
        contentType: "not a mime type",
        sizeBytes: 1024,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});
