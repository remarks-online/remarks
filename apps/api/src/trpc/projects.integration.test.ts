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
} from "../../test/integration/db.js";

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

const { buildServer } = await import("../server.js");

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

function listUrl(orgId: string): string {
  const input = encodeURIComponent(JSON.stringify({ orgId }));
  return `/trpc/projects.list?input=${input}`;
}

function getBySlugUrl(orgId: string, slug: string): string {
  const input = encodeURIComponent(JSON.stringify({ orgId, slug }));
  return `/trpc/projects.getBySlug?input=${input}`;
}

interface CreateInput {
  orgId: string;
  input: {
    name: string;
    slug: string;
    gitRepoUrl?: string;
    primaryBranch?: string;
  };
}

async function invokeCreate(server: FastifyInstance, payload: CreateInput, authorized: boolean) {
  return server.inject({
    method: "POST",
    url: "/trpc/projects.create",
    headers: {
      ...(authorized ? { authorization: BEARER } : {}),
      "content-type": "application/json",
    },
    payload,
  });
}

describe("tRPC projects.list (integration)", () => {
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

  test("member of org → 200, returns projects sorted newest first", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_list_happy" });
    const user = await seedUser(db, { clerkUserId: "user_list_happy" });

    const older = await insertProject(db, { orgId: org.id, name: "Older", slug: "older" });
    // Force a distinguishable createdAt so ordering is deterministic across fast inserts.
    await db
      .update(schema.projects)
      .set({ createdAt: new Date(older.createdAt.getTime() - 60_000) })
      .where(eq(schema.projects.id, older.id));
    const newer = await insertProject(db, { orgId: org.id, name: "Newer", slug: "newer" });

    // Make the caller a project admin on `newer`, leave `older` with no
    // membership so we exercise the LEFT-JOIN myRole=null branch.
    await db.insert(schema.projectMembers).values({
      projectId: newer.id,
      userId: user.id,
      role: "admin",
    });

    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "GET",
      url: listUrl(org.clerkOrgId),
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(200);
    const { items } = res.json().result.data;
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe(newer.id);
    expect(items[1].id).toBe(older.id);
    expect(items[0]).toMatchObject({
      orgId: org.id,
      name: "Newer",
      slug: "newer",
      primaryBranch: "main",
      gitRepoUrl: null,
      myRole: "admin",
    });
    expect(items[1].myRole).toBeNull();
  });

  test("member of org with zero projects → 200, empty list", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_list_empty" });
    const user = await seedUser(db, { clerkUserId: "user_list_empty" });

    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "GET",
      url: listUrl(org.clerkOrgId),
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().result.data.items).toEqual([]);
  });

  test("non-member of org → FORBIDDEN, not 200 with empty list", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_list_other" });
    await insertProject(db, { orgId: org.id, name: "Secret", slug: "secret" });

    const user = await seedUser(db, { clerkUserId: "user_list_outsider" });
    mockAuth({ clerkUserId: user.clerkUserId, memberships: [] });

    const res = await server.inject({
      method: "GET",
      url: listUrl(org.clerkOrgId),
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.data.code).toBe("FORBIDDEN");
  });

  test("member of one org cannot list another org's projects → FORBIDDEN", async () => {
    const db = await getIntegrationDb();
    const myOrg = await seedOrg(db, { clerkOrgId: "org_list_mine" });
    const otherOrg = await seedOrg(db, { clerkOrgId: "org_list_theirs" });
    await insertProject(db, { orgId: otherOrg.id, name: "Theirs", slug: "theirs" });

    const user = await seedUser(db, { clerkUserId: "user_list_crossed" });
    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: myOrg.clerkOrgId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "GET",
      url: listUrl(otherOrg.clerkOrgId),
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.data.code).toBe("FORBIDDEN");
  });

  test("missing Authorization → 401 UNAUTHORIZED", async () => {
    const res = await server.inject({
      method: "GET",
      url: listUrl("org_anything"),
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});

describe("tRPC projects.getBySlug (integration)", () => {
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

  test("member of org → 200, returns project by slug with myRole", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_slug_happy" });
    const user = await seedUser(db, { clerkUserId: "user_slug_happy" });
    const project = await insertProject(db, { orgId: org.id, name: "Demo", slug: "demo" });
    await db.insert(schema.projectMembers).values({
      projectId: project.id,
      userId: user.id,
      role: "editor",
    });

    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "GET",
      url: getBySlugUrl(org.clerkOrgId, "demo"),
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().result.data).toMatchObject({
      id: project.id,
      orgId: org.id,
      name: "Demo",
      slug: "demo",
      primaryBranch: "main",
      myRole: "editor",
    });
  });

  test("org member who isn't a project member → 200, myRole=null", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_slug_orgonly" });
    const user = await seedUser(db, { clerkUserId: "user_slug_orgonly" });
    await insertProject(db, { orgId: org.id, name: "Demo", slug: "orgonly" });

    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "GET",
      url: getBySlugUrl(org.clerkOrgId, "orgonly"),
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().result.data.myRole).toBeNull();
  });

  test("unknown slug in member's org → NOT_FOUND", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_slug_missing" });
    const user = await seedUser(db, { clerkUserId: "user_slug_missing" });
    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "GET",
      url: getBySlugUrl(org.clerkOrgId, "does-not-exist"),
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.data.code).toBe("NOT_FOUND");
  });

  test("non-member of org → FORBIDDEN, doesn't leak project existence", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_slug_secret" });
    await insertProject(db, { orgId: org.id, name: "Secret", slug: "secret" });

    const user = await seedUser(db, { clerkUserId: "user_slug_outsider" });
    mockAuth({ clerkUserId: user.clerkUserId, memberships: [] });

    const res = await server.inject({
      method: "GET",
      url: getBySlugUrl(org.clerkOrgId, "secret"),
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.data.code).toBe("FORBIDDEN");
  });

  test("same slug across orgs resolves per-org (no cross-org leak)", async () => {
    const db = await getIntegrationDb();
    const myOrg = await seedOrg(db, { clerkOrgId: "org_slug_mine" });
    const otherOrg = await seedOrg(db, { clerkOrgId: "org_slug_theirs" });
    const mine = await insertProject(db, { orgId: myOrg.id, name: "Mine", slug: "shared" });
    await insertProject(db, { orgId: otherOrg.id, name: "Theirs", slug: "shared" });

    const user = await seedUser(db, { clerkUserId: "user_slug_cross" });
    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: myOrg.clerkOrgId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "GET",
      url: getBySlugUrl(myOrg.clerkOrgId, "shared"),
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().result.data.id).toBe(mine.id);
  });
});

describe("tRPC projects.create (integration)", () => {
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

  test("org admin → project row and creator membership both inserted", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_create_admin" });
    const user = await seedUser(db, { clerkUserId: "user_create_admin" });
    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:admin" }],
    });

    const res = await invokeCreate(
      server,
      { orgId: org.clerkOrgId, input: { name: "Acme Web", slug: "acme-web" } },
      true
    );

    expect(res.statusCode).toBe(200);
    const body = res.json().result.data;
    expect(body).toMatchObject({
      orgId: org.id,
      name: "Acme Web",
      slug: "acme-web",
      gitRepoUrl: null,
      primaryBranch: "main",
      // Creator is always admin of the new project (A14).
      myRole: "admin",
    });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);

    const projectRow = await db.query.projects.findFirst({
      where: eq(schema.projects.id, body.id),
    });
    expect(projectRow?.slug).toBe("acme-web");

    const memberRow = await db.query.projectMembers.findFirst({
      where: eq(schema.projectMembers.projectId, body.id),
    });
    expect(memberRow?.userId).toBe(user.id);
    expect(memberRow?.role).toBe("admin");
  });

  test("org member (not admin) → FORBIDDEN, no project inserted", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_create_member" });
    const user = await seedUser(db, { clerkUserId: "user_create_plain" });
    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:member" }],
    });

    const res = await invokeCreate(
      server,
      { orgId: org.clerkOrgId, input: { name: "Acme", slug: "acme" } },
      true
    );

    expect(res.statusCode).toBe(403);
    expect(res.json().error.data.code).toBe("FORBIDDEN");

    const rows = await db.query.projects.findMany({
      where: eq(schema.projects.orgId, org.id),
    });
    expect(rows).toHaveLength(0);
  });

  test("non-member → FORBIDDEN", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_create_target" });
    const otherOrg = await seedOrg(db, { clerkOrgId: "org_create_other" });
    const user = await seedUser(db, { clerkUserId: "user_create_outsider" });
    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: otherOrg.clerkOrgId, role: "org:admin" }],
    });

    const res = await invokeCreate(
      server,
      { orgId: org.clerkOrgId, input: { name: "Acme", slug: "acme" } },
      true
    );

    expect(res.statusCode).toBe(403);
    expect(res.json().error.data.code).toBe("FORBIDDEN");
  });

  test("duplicate slug in same org → CONFLICT", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_create_dup" });
    const user = await seedUser(db, { clerkUserId: "user_create_dup" });

    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:admin" }],
    });
    const first = await invokeCreate(
      server,
      { orgId: org.clerkOrgId, input: { name: "Acme", slug: "acme" } },
      true
    );
    expect(first.statusCode).toBe(200);

    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:admin" }],
    });
    const second = await invokeCreate(
      server,
      { orgId: org.clerkOrgId, input: { name: "Acme Two", slug: "acme" } },
      true
    );
    expect(second.statusCode).toBe(409);
    expect(second.json().error.data.code).toBe("CONFLICT");
  });

  test("invalid slug → BAD_REQUEST", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_create_badslug" });
    const user = await seedUser(db, { clerkUserId: "user_create_badslug" });
    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:admin" }],
    });

    const res = await invokeCreate(
      server,
      { orgId: org.clerkOrgId, input: { name: "Acme", slug: "NOT A SLUG" } },
      true
    );

    expect(res.statusCode).toBe(400);
    expect(res.json().error.data.code).toBe("BAD_REQUEST");
  });

  test("missing Authorization → UNAUTHORIZED", async () => {
    const res = await invokeCreate(
      server,
      { orgId: "org_anything", input: { name: "Acme", slug: "acme" } },
      false
    );

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});

interface SeededProjectMember {
  org: typeof schema.organizations.$inferSelect;
  user: typeof schema.users.$inferSelect;
  project: typeof schema.projects.$inferSelect;
}

async function seedProjectMember(
  db: Awaited<ReturnType<typeof getIntegrationDb>>,
  args: { role: "admin" | "editor" | "viewer"; clerkSuffix: string }
): Promise<SeededProjectMember> {
  const org = await seedOrg(db, { clerkOrgId: `org_${args.clerkSuffix}` });
  const user = await seedUser(db, { clerkUserId: `user_${args.clerkSuffix}` });
  const project = await insertProject(db, {
    orgId: org.id,
    name: "Original",
    slug: `slug-${args.clerkSuffix}`,
  });
  await db.insert(schema.projectMembers).values({
    projectId: project.id,
    userId: user.id,
    role: args.role,
  });
  return { org, user, project };
}

describe("tRPC projects.update (integration)", () => {
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

  test("project admin → 200, name and slug updated", async () => {
    const db = await getIntegrationDb();
    const { org, user, project } = await seedProjectMember(db, {
      role: "admin",
      clerkSuffix: "update_admin",
    });
    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:admin" }],
    });

    const res = await server.inject({
      method: "POST",
      url: "/trpc/projects.update",
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { projectId: project.id, input: { name: "Renamed", slug: "renamed" } },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json().result.data;
    expect(body).toMatchObject({
      id: project.id,
      name: "Renamed",
      slug: "renamed",
      // Caller is admin (asserted by the procedure); response carries it (A14).
      myRole: "admin",
    });
  });

  test("project editor → FORBIDDEN", async () => {
    const db = await getIntegrationDb();
    const { org, user, project } = await seedProjectMember(db, {
      role: "editor",
      clerkSuffix: "update_editor",
    });
    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "POST",
      url: "/trpc/projects.update",
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { projectId: project.id, input: { name: "Renamed" } },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.data.code).toBe("FORBIDDEN");
  });

  test("non-member → NOT_FOUND, project existence not leaked", async () => {
    const db = await getIntegrationDb();
    const { project } = await seedProjectMember(db, {
      role: "admin",
      clerkSuffix: "update_target",
    });
    const otherOrg = await seedOrg(db, { clerkOrgId: "org_update_outsider" });
    const outsider = await seedUser(db, { clerkUserId: "user_update_outsider" });
    mockAuth({
      clerkUserId: outsider.clerkUserId,
      memberships: [{ clerkOrgId: otherOrg.clerkOrgId, role: "org:admin" }],
    });

    const res = await server.inject({
      method: "POST",
      url: "/trpc/projects.update",
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { projectId: project.id, input: { name: "Sneaky" } },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.data.code).toBe("NOT_FOUND");
  });

  test("slug already taken → CONFLICT", async () => {
    const db = await getIntegrationDb();
    const { org, user, project } = await seedProjectMember(db, {
      role: "admin",
      clerkSuffix: "update_conflict",
    });
    await insertProject(db, { orgId: org.id, name: "Other", slug: "taken" });
    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:admin" }],
    });

    const res = await server.inject({
      method: "POST",
      url: "/trpc/projects.update",
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { projectId: project.id, input: { slug: "taken" } },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.data.code).toBe("CONFLICT");
  });
});

describe("tRPC projects.delete (integration)", () => {
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

  test("project admin → 200, project row gone", async () => {
    const db = await getIntegrationDb();
    const { org, user, project } = await seedProjectMember(db, {
      role: "admin",
      clerkSuffix: "delete_admin",
    });
    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:admin" }],
    });

    const res = await server.inject({
      method: "POST",
      url: "/trpc/projects.delete",
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { projectId: project.id },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().result.data).toEqual({ id: project.id });

    const remaining = await db.query.projects.findMany({
      where: eq(schema.projects.id, project.id),
    });
    expect(remaining).toHaveLength(0);
  });

  test("project editor → FORBIDDEN, project still present", async () => {
    const db = await getIntegrationDb();
    const { org, user, project } = await seedProjectMember(db, {
      role: "editor",
      clerkSuffix: "delete_editor",
    });
    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "POST",
      url: "/trpc/projects.delete",
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { projectId: project.id },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.data.code).toBe("FORBIDDEN");

    const remaining = await db.query.projects.findMany({
      where: eq(schema.projects.id, project.id),
    });
    expect(remaining).toHaveLength(1);
  });

  test("non-member → NOT_FOUND, project still present", async () => {
    const db = await getIntegrationDb();
    const { project } = await seedProjectMember(db, {
      role: "admin",
      clerkSuffix: "delete_target",
    });
    const otherOrg = await seedOrg(db, { clerkOrgId: "org_delete_outsider" });
    const outsider = await seedUser(db, { clerkUserId: "user_delete_outsider" });
    mockAuth({
      clerkUserId: outsider.clerkUserId,
      memberships: [{ clerkOrgId: otherOrg.clerkOrgId, role: "org:admin" }],
    });

    const res = await server.inject({
      method: "POST",
      url: "/trpc/projects.delete",
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { projectId: project.id },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.data.code).toBe("NOT_FOUND");

    const remaining = await db.query.projects.findMany({
      where: eq(schema.projects.id, project.id),
    });
    expect(remaining).toHaveLength(1);
  });
});
