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

describe("GET /projects/:projectId/annotations (integration)", () => {
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

  test("paginates through 100 seeded annotations with limit=25", async () => {
    const { orgClerkId, userClerkId, userId, projectId } = await seedProjectWithMember({
      role: "viewer",
    });
    const db = await getIntegrationDb();

    const [mainBranch] = await db
      .insert(schema.branches)
      .values({ projectId, name: "main" })
      .returning();
    const [featureBranch] = await db
      .insert(schema.branches)
      .values({ projectId, name: "feature/x" })
      .returning();
    if (!mainBranch || !featureBranch) throw new Error("branch seed returned no rows");

    // Stagger createdAt by 1s per row so ordering is deterministic regardless
    // of insert clock resolution. Mix branches and statuses so filter tests
    // have something to work against.
    const base = new Date("2026-01-01T00:00:00.000Z").getTime();
    const statuses = ["to_do", "doing", "done", "rejected"] as const;
    const rows = Array.from({ length: 100 }, (_, i) => ({
      projectId,
      branchId: i % 2 === 0 ? mainBranch.id : featureBranch.id,
      authorId: userId,
      status: statuses[i % statuses.length],
      targetType: "element" as const,
      url: `https://staging.acme.com/page-${i}`,
      targetSelector: `body > main > #el-${i}`,
      viewport: { width: 1920, height: 1080, dpr: 2 },
      commentText: `Comment ${i}`,
      createdAt: new Date(base + i * 1000),
      updatedAt: new Date(base + i * 1000),
    }));
    await db.insert(schema.annotations).values(rows);

    // Paginate: 4 pages of 25 each.
    const collected: Array<{ id: string; createdAt: string }> = [];
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      mockAuth({
        clerkUserId: userClerkId,
        memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
      });
      const qs = new URLSearchParams({ limit: "25" });
      if (cursor) qs.set("cursor", cursor);
      const res = await server.inject({
        method: "GET",
        url: `/projects/${projectId}/annotations?${qs.toString()}`,
        headers: { authorization: BEARER },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        items: Array<{ id: string; createdAt: string }>;
        nextCursor: string | null;
      };
      expect(body.items.length).toBeLessThanOrEqual(25);
      for (const item of body.items) {
        collected.push({ id: item.id, createdAt: item.createdAt });
      }
      pages += 1;
      if (!body.nextCursor) break;
      cursor = body.nextCursor;
      if (pages > 10) throw new Error("paginated more than 10 pages; bug?");
    }

    expect(pages).toBe(4);
    expect(collected).toHaveLength(100);
    // Strictly descending by createdAt (inserts are 1s apart so no ties).
    for (let i = 1; i < collected.length; i++) {
      const prev = collected[i - 1];
      const curr = collected[i];
      if (!prev || !curr) throw new Error("unreachable: array bounds");
      expect(new Date(prev.createdAt).getTime()).toBeGreaterThan(
        new Date(curr.createdAt).getTime()
      );
    }
    // No duplicates across pages.
    expect(new Set(collected.map((x) => x.id)).size).toBe(100);
  });

  test("filter: status=done returns only done annotations", async () => {
    const { orgClerkId, userClerkId, userId, projectId } = await seedProjectWithMember({
      role: "viewer",
    });
    const db = await getIntegrationDb();
    const [branch] = await db
      .insert(schema.branches)
      .values({ projectId, name: "main" })
      .returning();
    if (!branch) throw new Error("branch seed returned no rows");

    const rows = Array.from({ length: 12 }, (_, i) => ({
      projectId,
      branchId: branch.id,
      authorId: userId,
      status: (i % 2 === 0 ? "done" : "to_do") as "done" | "to_do",
      targetType: "element" as const,
      url: "https://staging.acme.com/page",
      targetSelector: `#el-${i}`,
      viewport: { width: 1920, height: 1080, dpr: 2 },
      commentText: `Comment ${i}`,
    }));
    await db.insert(schema.annotations).values(rows);

    mockAuth({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });
    const res = await server.inject({
      method: "GET",
      url: `/projects/${projectId}/annotations?status=done`,
      headers: { authorization: BEARER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(6);
    expect(body.nextCursor).toBeNull();
    for (const item of body.items) expect(item.status).toBe("done");
  });

  test("filter: branch=main returns only annotations on that branch", async () => {
    const { orgClerkId, userClerkId, userId, projectId } = await seedProjectWithMember({
      role: "viewer",
    });
    const db = await getIntegrationDb();
    const [main] = await db.insert(schema.branches).values({ projectId, name: "main" }).returning();
    const [other] = await db
      .insert(schema.branches)
      .values({ projectId, name: "feature/y" })
      .returning();
    if (!main || !other) throw new Error("branch seed returned no rows");

    const rows = Array.from({ length: 10 }, (_, i) => ({
      projectId,
      branchId: i < 4 ? main.id : other.id,
      authorId: userId,
      status: "to_do" as const,
      targetType: "element" as const,
      url: "https://staging.acme.com/page",
      targetSelector: `#el-${i}`,
      viewport: { width: 1920, height: 1080, dpr: 2 },
      commentText: `Comment ${i}`,
    }));
    await db.insert(schema.annotations).values(rows);

    mockAuth({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });
    const res = await server.inject({
      method: "GET",
      url: `/projects/${projectId}/annotations?branch=main`,
      headers: { authorization: BEARER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(4);
    for (const item of body.items) {
      expect(item.branchId).toBe(main.id);
      expect(item.branchName).toBe("main");
    }
  });

  test("filter: branch=<nonexistent> returns empty page without erroring", async () => {
    const { orgClerkId, userClerkId, userId, projectId } = await seedProjectWithMember({
      role: "viewer",
    });
    const db = await getIntegrationDb();
    const [main] = await db.insert(schema.branches).values({ projectId, name: "main" }).returning();
    if (!main) throw new Error("branch seed returned no rows");
    await db.insert(schema.annotations).values({
      projectId,
      branchId: main.id,
      authorId: userId,
      status: "to_do",
      targetType: "element",
      url: "https://staging.acme.com/page",
      targetSelector: "#el",
      viewport: { width: 1920, height: 1080, dpr: 2 },
      commentText: "Comment",
    });

    mockAuth({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });
    const res = await server.inject({
      method: "GET",
      url: `/projects/${projectId}/annotations?branch=does-not-exist`,
      headers: { authorization: BEARER },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], nextCursor: null });
  });

  test("combined filters: status=done AND branch=main", async () => {
    const { orgClerkId, userClerkId, userId, projectId } = await seedProjectWithMember({
      role: "viewer",
    });
    const db = await getIntegrationDb();
    const [main] = await db.insert(schema.branches).values({ projectId, name: "main" }).returning();
    const [other] = await db
      .insert(schema.branches)
      .values({ projectId, name: "feature/z" })
      .returning();
    if (!main || !other) throw new Error("branch seed returned no rows");

    const configs: Array<{ branchId: string; status: "done" | "to_do" }> = [
      { branchId: main.id, status: "done" },
      { branchId: main.id, status: "done" },
      { branchId: main.id, status: "to_do" },
      { branchId: other.id, status: "done" },
      { branchId: other.id, status: "to_do" },
    ];
    await db.insert(schema.annotations).values(
      configs.map((c, i) => ({
        projectId,
        branchId: c.branchId,
        authorId: userId,
        status: c.status,
        targetType: "element" as const,
        url: "https://staging.acme.com/page",
        targetSelector: `#el-${i}`,
        viewport: { width: 1920, height: 1080, dpr: 2 },
        commentText: `Comment ${i}`,
      }))
    );

    mockAuth({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });
    const res = await server.inject({
      method: "GET",
      url: `/projects/${projectId}/annotations?status=done&branch=main`,
      headers: { authorization: BEARER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(2);
    for (const item of body.items) {
      expect(item.status).toBe("done");
      expect(item.branchId).toBe(main.id);
    }
  });

  test("filter: url=<exact match> returns only annotations with that URL", async () => {
    const { orgClerkId, userClerkId, userId, projectId } = await seedProjectWithMember({
      role: "viewer",
    });
    const db = await getIntegrationDb();
    const [branch] = await db
      .insert(schema.branches)
      .values({ projectId, name: "main" })
      .returning();
    if (!branch) throw new Error("branch seed returned no rows");

    const targetUrl = "https://staging.acme.com/checkout";
    const otherUrl = "https://staging.acme.com/cart";
    const rows = [
      ...Array.from({ length: 3 }, (_, i) => ({
        projectId,
        branchId: branch.id,
        authorId: userId,
        status: "to_do" as const,
        targetType: "element" as const,
        url: targetUrl,
        targetSelector: `#match-${i}`,
        viewport: { width: 1920, height: 1080, dpr: 2 },
        commentText: `Match ${i}`,
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        projectId,
        branchId: branch.id,
        authorId: userId,
        status: "to_do" as const,
        targetType: "element" as const,
        url: otherUrl,
        targetSelector: `#other-${i}`,
        viewport: { width: 1920, height: 1080, dpr: 2 },
        commentText: `Other ${i}`,
      })),
    ];
    await db.insert(schema.annotations).values(rows);

    mockAuth({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });
    const res = await server.inject({
      method: "GET",
      url: `/projects/${projectId}/annotations?url=${encodeURIComponent(targetUrl)}`,
      headers: { authorization: BEARER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(3);
    for (const item of body.items) expect(item.url).toBe(targetUrl);
  });

  test("filter: url=<no matches> returns empty page without erroring", async () => {
    const { orgClerkId, userClerkId, userId, projectId } = await seedProjectWithMember({
      role: "viewer",
    });
    const db = await getIntegrationDb();
    const [branch] = await db
      .insert(schema.branches)
      .values({ projectId, name: "main" })
      .returning();
    if (!branch) throw new Error("branch seed returned no rows");
    await db.insert(schema.annotations).values({
      projectId,
      branchId: branch.id,
      authorId: userId,
      status: "to_do",
      targetType: "element",
      url: "https://staging.acme.com/page",
      targetSelector: "#el",
      viewport: { width: 1920, height: 1080, dpr: 2 },
      commentText: "Comment",
    });

    mockAuth({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });
    const res = await server.inject({
      method: "GET",
      url: `/projects/${projectId}/annotations?url=${encodeURIComponent("https://staging.acme.com/no-match")}`,
      headers: { authorization: BEARER },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], nextCursor: null });
  });

  test("combined filters: status=done AND branch=main AND url=<x>", async () => {
    const { orgClerkId, userClerkId, userId, projectId } = await seedProjectWithMember({
      role: "viewer",
    });
    const db = await getIntegrationDb();
    const [main] = await db.insert(schema.branches).values({ projectId, name: "main" }).returning();
    const [other] = await db
      .insert(schema.branches)
      .values({ projectId, name: "feature/triple" })
      .returning();
    if (!main || !other) throw new Error("branch seed returned no rows");

    const targetUrl = "https://staging.acme.com/triple";
    const otherUrl = "https://staging.acme.com/elsewhere";
    type Variant = { branchId: string; status: "done" | "to_do"; url: string };
    const variants: Variant[] = [
      { branchId: main.id, status: "done", url: targetUrl }, // ✓ match
      { branchId: main.id, status: "done", url: targetUrl }, // ✓ match
      { branchId: main.id, status: "to_do", url: targetUrl }, // ✗ status
      { branchId: main.id, status: "done", url: otherUrl }, // ✗ url
      { branchId: other.id, status: "done", url: targetUrl }, // ✗ branch
    ];
    await db.insert(schema.annotations).values(
      variants.map((v, i) => ({
        projectId,
        branchId: v.branchId,
        authorId: userId,
        status: v.status,
        targetType: "element" as const,
        url: v.url,
        targetSelector: `#el-${i}`,
        viewport: { width: 1920, height: 1080, dpr: 2 },
        commentText: `Comment ${i}`,
      }))
    );

    mockAuth({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });
    const res = await server.inject({
      method: "GET",
      url: `/projects/${projectId}/annotations?status=done&branch=main&url=${encodeURIComponent(targetUrl)}`,
      headers: { authorization: BEARER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(2);
    for (const item of body.items) {
      expect(item.status).toBe("done");
      expect(item.branchId).toBe(main.id);
      expect(item.url).toBe(targetUrl);
    }
  });

  test("invalid cursor → 400 VALIDATION_ERROR", async () => {
    const { orgClerkId, userClerkId, projectId } = await seedProjectWithMember({ role: "viewer" });
    mockAuth({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });
    const res = await server.inject({
      method: "GET",
      url: `/projects/${projectId}/annotations?cursor=not-base64-json`,
      headers: { authorization: BEARER },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  test("limit=0 → 400 VALIDATION_ERROR", async () => {
    const { orgClerkId, userClerkId, projectId } = await seedProjectWithMember({ role: "viewer" });
    mockAuth({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });
    const res = await server.inject({
      method: "GET",
      url: `/projects/${projectId}/annotations?limit=0`,
      headers: { authorization: BEARER },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  test("limit=101 → 400 VALIDATION_ERROR", async () => {
    const { orgClerkId, userClerkId, projectId } = await seedProjectWithMember({ role: "viewer" });
    mockAuth({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });
    const res = await server.inject({
      method: "GET",
      url: `/projects/${projectId}/annotations?limit=101`,
      headers: { authorization: BEARER },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  test("user from a different org → 404 NOT_FOUND", async () => {
    // Post-1.33 org membership implies project membership via the auth-plugin
    // backstop, so we exercise the guard from a wholly separate org.
    const db = await getIntegrationDb();
    const org = await seedOrg(db);
    const otherOrg = await seedOrg(db, { clerkOrgId: "org_anno_list_other" });
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
      method: "GET",
      url: `/projects/${project.id}/annotations`,
      headers: { authorization: BEARER },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  test("cross-project isolation: other projects' annotations don't leak", async () => {
    const db = await getIntegrationDb();
    const { orgClerkId, userClerkId, userId, projectId } = await seedProjectWithMember({
      role: "viewer",
    });

    // Seed a second project (no membership for our user) with its own annotations.
    const otherOrg = await seedOrg(db);
    const [otherProject] = await db
      .insert(schema.projects)
      .values({
        orgId: otherOrg.id,
        name: "Other",
        slug: `proj-${Math.random().toString(36).slice(2, 10)}`,
        gitRepoUrl: null,
        primaryBranch: "main",
      })
      .returning();
    if (!otherProject) throw new Error("other project insert returned no rows");
    const otherUser = await seedUser(db);
    const [otherBranch] = await db
      .insert(schema.branches)
      .values({ projectId: otherProject.id, name: "main" })
      .returning();
    if (!otherBranch) throw new Error("other branch insert returned no rows");
    await db.insert(schema.annotations).values({
      projectId: otherProject.id,
      branchId: otherBranch.id,
      authorId: otherUser.id,
      status: "to_do",
      targetType: "element",
      url: "https://other.example.com",
      targetSelector: "#el",
      viewport: { width: 1920, height: 1080, dpr: 2 },
      commentText: "OTHER PROJECT ANNOTATION",
    });

    // Seed our project with one annotation so the result is definitely not empty.
    const [ourBranch] = await db
      .insert(schema.branches)
      .values({ projectId, name: "main" })
      .returning();
    if (!ourBranch) throw new Error("our branch insert returned no rows");
    await db.insert(schema.annotations).values({
      projectId,
      branchId: ourBranch.id,
      authorId: userId,
      status: "to_do",
      targetType: "element",
      url: "https://acme.com",
      targetSelector: "#el",
      viewport: { width: 1920, height: 1080, dpr: 2 },
      commentText: "OUR PROJECT ANNOTATION",
    });

    mockAuth({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });
    const res = await server.inject({
      method: "GET",
      url: `/projects/${projectId}/annotations`,
      headers: { authorization: BEARER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].projectId).toBe(projectId);
    expect(body.items[0].commentText).toBe("OUR PROJECT ANNOTATION");
  });

  test("annotation with asset → presigned URL is populated", async () => {
    const { orgClerkId, userClerkId, userId, projectId } = await seedProjectWithMember({
      role: "viewer",
    });
    const db = await getIntegrationDb();
    const [branch] = await db
      .insert(schema.branches)
      .values({ projectId, name: "main" })
      .returning();
    if (!branch) throw new Error("branch seed returned no rows");

    const [annotation] = await db
      .insert(schema.annotations)
      .values({
        projectId,
        branchId: branch.id,
        authorId: userId,
        status: "to_do",
        targetType: "element",
        url: "https://acme.com",
        targetSelector: "#el",
        viewport: { width: 1920, height: 1080, dpr: 2 },
        commentText: "With asset",
      })
      .returning();
    if (!annotation) throw new Error("annotation insert returned no rows");

    const assetId = randomUUID();
    await db.insert(schema.annotationAssets).values({
      id: assetId,
      annotationId: annotation.id,
      kind: "screenshot",
      r2Key: `projects/${projectId}/screenshots/${assetId}`,
      contentType: "image/png",
      sizeBytes: 1234,
    });

    mockAuth({
      clerkUserId: userClerkId,
      memberships: [{ clerkOrgId: orgClerkId, role: "org:member" }],
    });
    const res = await server.inject({
      method: "GET",
      url: `/projects/${projectId}/annotations`,
      headers: { authorization: BEARER },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    const [item] = body.items;
    expect(item.assets).toHaveLength(1);
    expect(item.assets[0]).toMatchObject({
      id: assetId,
      kind: "screenshot",
      contentType: "image/png",
    });
    // Presigning doesn't require a real R2; the URL is derived locally from
    // credentials. Shape check only.
    expect(typeof item.assets[0].url).toBe("string");
    expect(item.assets[0].url).toMatch(/^https?:\/\//);

    // DB sanity.
    const assets = await db.query.annotationAssets.findMany({
      where: eq(schema.annotationAssets.annotationId, annotation.id),
    });
    expect(assets).toHaveLength(1);
  });
});
