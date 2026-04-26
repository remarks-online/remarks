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
  projectSlug: string;
}

async function seedProject(args: {
  role: "admin" | "editor" | "viewer";
  gitRepoUrl?: string | null;
}): Promise<SeededProject> {
  const db = await getIntegrationDb();
  const org = await seedOrg(db);
  const user = await seedUser(db);
  const slug = `proj-${Math.random().toString(36).slice(2, 10)}`;
  const [project] = await db
    .insert(schema.projects)
    .values({
      orgId: org.id,
      name: "Original Name",
      slug,
      gitRepoUrl: args.gitRepoUrl ?? null,
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
    projectSlug: project.slug,
  };
}

describe("PATCH /projects/:projectId (integration)", () => {
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

  test("project admin → 200, name+slug updated, updatedAt advances", async () => {
    const seeded = await seedProject({ role: "admin" });
    const db = await getIntegrationDb();
    const before = await db.query.projects.findFirst({
      where: eq(schema.projects.id, seeded.projectId),
    });
    if (!before) throw new Error("seeded project missing");

    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:admin" }],
    });

    const res = await server.inject({
      method: "PATCH",
      url: `/projects/${seeded.projectId}`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { name: "Renamed", slug: "renamed-slug" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      id: seeded.projectId,
      name: "Renamed",
      slug: "renamed-slug",
      primaryBranch: "main",
      myRole: "admin",
    });

    const after = await db.query.projects.findFirst({
      where: eq(schema.projects.id, seeded.projectId),
    });
    expect(after?.name).toBe("Renamed");
    expect(after?.slug).toBe("renamed-slug");
    expect(after?.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  test("gitRepoUrl: null clears the existing value", async () => {
    const seeded = await seedProject({
      role: "admin",
      gitRepoUrl: "https://github.com/acme/web",
    });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:admin" }],
    });

    const res = await server.inject({
      method: "PATCH",
      url: `/projects/${seeded.projectId}`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { gitRepoUrl: null },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().gitRepoUrl).toBeNull();
  });

  test("project editor → 403 FORBIDDEN", async () => {
    const seeded = await seedProject({ role: "editor" });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "PATCH",
      url: `/projects/${seeded.projectId}`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { name: "Renamed" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  test("project viewer → 403 FORBIDDEN", async () => {
    const seeded = await seedProject({ role: "viewer" });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "PATCH",
      url: `/projects/${seeded.projectId}`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { name: "Renamed" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  test("non-member → 404 NOT_FOUND, project existence not leaked", async () => {
    const db = await getIntegrationDb();
    const targetOrg = await seedOrg(db);
    const [project] = await db
      .insert(schema.projects)
      .values({
        orgId: targetOrg.id,
        name: "Hidden",
        slug: "hidden",
        primaryBranch: "main",
      })
      .returning();
    if (!project) throw new Error("project insert returned no rows");

    const otherOrg = await seedOrg(db);
    const outsider = await seedUser(db);
    mockAuth({
      clerkUserId: outsider.clerkUserId,
      memberships: [{ clerkOrgId: otherOrg.clerkOrgId, role: "org:admin" }],
    });

    const res = await server.inject({
      method: "PATCH",
      url: `/projects/${project.id}`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { name: "Sneaky" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  test("slug already taken in same org → 409 CONFLICT", async () => {
    const db = await getIntegrationDb();
    const seeded = await seedProject({ role: "admin" });
    const [other] = await db
      .insert(schema.projects)
      .values({
        orgId: (
          await db.query.organizations.findFirst({
            where: eq(schema.organizations.clerkOrgId, seeded.orgClerkId),
            columns: { id: true },
          })
        )?.id as string,
        name: "Other",
        slug: "taken-slug",
        primaryBranch: "main",
      })
      .returning();
    if (!other) throw new Error("other project insert returned no rows");

    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:admin" }],
    });

    const res = await server.inject({
      method: "PATCH",
      url: `/projects/${seeded.projectId}`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { slug: "taken-slug" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONFLICT");
  });

  test("same slug in a different org is allowed (uniqueness is per-org)", async () => {
    const db = await getIntegrationDb();
    const seeded = await seedProject({ role: "admin" });
    const otherOrg = await seedOrg(db);
    await db.insert(schema.projects).values({
      orgId: otherOrg.id,
      name: "Cross-org collision",
      slug: "cross-slug",
      primaryBranch: "main",
    });

    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:admin" }],
    });

    const res = await server.inject({
      method: "PATCH",
      url: `/projects/${seeded.projectId}`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { slug: "cross-slug" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().slug).toBe("cross-slug");
  });

  test("empty body {} → 400 VALIDATION_ERROR (refine fires)", async () => {
    const seeded = await seedProject({ role: "admin" });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:admin" }],
    });

    const res = await server.inject({
      method: "PATCH",
      url: `/projects/${seeded.projectId}`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  test("invalid slug regex → 400 VALIDATION_ERROR", async () => {
    const seeded = await seedProject({ role: "admin" });
    mockAuth({
      clerkUserId: seeded.userClerkId,
      memberships: [{ clerkOrgId: seeded.orgClerkId, role: "org:admin" }],
    });

    const res = await server.inject({
      method: "PATCH",
      url: `/projects/${seeded.projectId}`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { slug: "NOT A SLUG" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});
