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

async function insertProject(
  db: Awaited<ReturnType<typeof getIntegrationDb>>,
  values: {
    orgId: string;
    name: string;
    slug: string;
    gitRepoUrl?: string | null;
    primaryBranch?: string;
  }
): Promise<typeof schema.projects.$inferSelect> {
  const [row] = await db
    .insert(schema.projects)
    .values({
      orgId: values.orgId,
      name: values.name,
      slug: values.slug,
      gitRepoUrl: values.gitRepoUrl ?? null,
      primaryBranch: values.primaryBranch ?? "main",
    })
    .returning();
  if (!row) throw new Error("insertProject: no row returned");
  return row;
}

async function addProjectMember(
  db: Awaited<ReturnType<typeof getIntegrationDb>>,
  args: { projectId: string; userId: string; role?: "admin" | "editor" | "viewer" }
): Promise<void> {
  await db.insert(schema.projectMembers).values({
    projectId: args.projectId,
    userId: args.userId,
    role: args.role ?? "editor",
  });
}

describe("GET /orgs/:orgId/projects (integration)", () => {
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

  test("org member sees projects for that org only, ordered newest-first", async () => {
    const db = await getIntegrationDb();
    const targetOrg = await seedOrg(db, { clerkOrgId: "org_list_target" });
    const siblingOrg = await seedOrg(db, { clerkOrgId: "org_list_sibling" });
    const user = await seedUser(db, { clerkUserId: "user_list_member" });

    const older = await insertProject(db, {
      orgId: targetOrg.id,
      name: "Older",
      slug: "older",
    });
    // Ensure distinct createdAt timestamps for the order assertion.
    await new Promise((r) => setTimeout(r, 10));
    const newer = await insertProject(db, {
      orgId: targetOrg.id,
      name: "Newer",
      slug: "newer",
    });
    await insertProject(db, {
      orgId: siblingOrg.id,
      name: "Sibling",
      slug: "sibling",
    });

    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: targetOrg.clerkOrgId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "GET",
      url: `/orgs/${targetOrg.clerkOrgId}/projects`,
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(2);
    expect(body.items[0].id).toBe(newer.id);
    expect(body.items[1].id).toBe(older.id);
    expect(body.items[0]).toMatchObject({
      orgId: targetOrg.id,
      name: "Newer",
      slug: "newer",
      gitRepoUrl: null,
      primaryBranch: "main",
    });
    expect(body.items[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("returns empty list when org has no projects", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_list_empty" });
    const user = await seedUser(db, { clerkUserId: "user_list_empty" });

    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "GET",
      url: `/orgs/${org.clerkOrgId}/projects`,
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });

  test("non-member of org → 403 FORBIDDEN", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_list_forbidden" });
    const otherOrg = await seedOrg(db, { clerkOrgId: "org_list_other" });
    const user = await seedUser(db, { clerkUserId: "user_list_outsider" });
    await insertProject(db, { orgId: org.id, name: "Secret", slug: "secret" });

    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: otherOrg.clerkOrgId, role: "org:admin" }],
    });

    const res = await server.inject({
      method: "GET",
      url: `/orgs/${org.clerkOrgId}/projects`,
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  test("clerk org with no matching DB row → auth plugin lazy-provisions it, 200 empty list", async () => {
    const db = await getIntegrationDb();
    const user = await seedUser(db, { clerkUserId: "user_list_unknown_org" });

    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: "org_unsynced", role: "org:admin" }],
    });

    const res = await server.inject({
      method: "GET",
      url: "/orgs/org_unsynced/projects",
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
    const provisioned = await db.query.organizations.findFirst({
      where: eq(schema.organizations.clerkOrgId, "org_unsynced"),
    });
    expect(provisioned).toBeDefined();
    expect(provisioned?.name).toBe("org_unsynced");
    expect(provisioned?.slug).toBe("org_unsynced");
  });
});

describe("GET /projects/:projectId (integration)", () => {
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

  test("project member → 200 with ProjectResponse body", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_detail_member" });
    const user = await seedUser(db, { clerkUserId: "user_detail_member" });
    const project = await insertProject(db, {
      orgId: org.id,
      name: "Detail Project",
      slug: "detail",
      gitRepoUrl: "https://github.com/acme/detail",
      primaryBranch: "develop",
    });
    await addProjectMember(db, {
      projectId: project.id,
      userId: user.id,
      role: "viewer",
    });

    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "GET",
      url: `/projects/${project.id}`,
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: project.id,
      orgId: org.id,
      name: "Detail Project",
      slug: "detail",
      gitRepoUrl: "https://github.com/acme/detail",
      primaryBranch: "develop",
      myRole: "viewer",
    });
  });

  test("non-member of existing project → 404 NOT_FOUND (existence not leaked)", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_detail_outsider" });
    const owner = await seedUser(db, { clerkUserId: "user_detail_owner" });
    const outsider = await seedUser(db, { clerkUserId: "user_detail_outsider" });
    const project = await insertProject(db, {
      orgId: org.id,
      name: "Private",
      slug: "private",
    });
    await addProjectMember(db, {
      projectId: project.id,
      userId: owner.id,
      role: "admin",
    });

    mockAuth({
      clerkUserId: outsider.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "GET",
      url: `/projects/${project.id}`,
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  test("unknown projectId (valid uuid, no row) → 404 NOT_FOUND", async () => {
    const db = await getIntegrationDb();
    const user = await seedUser(db, { clerkUserId: "user_detail_missing" });

    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [],
    });

    const res = await server.inject({
      method: "GET",
      url: "/projects/00000000-0000-4000-8000-000000000000",
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  test("malformed projectId → 400 VALIDATION_ERROR", async () => {
    const db = await getIntegrationDb();
    const user = await seedUser(db, { clerkUserId: "user_detail_badid" });

    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [],
    });

    const res = await server.inject({
      method: "GET",
      url: "/projects/not-a-uuid",
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(res.json().error.issues)).toBe(true);
  });
});
