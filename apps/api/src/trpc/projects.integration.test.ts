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
  // users.getOrganizationMembershipList → "what orgs is *this user* a member of?"
  // Called by the auth plugin on every authenticated request.
  getOrganizationMembershipList: vi.fn(),
  // organizations.getOrganizationMembershipList → "who are *this org's* members?"
  // Called by createProject to fan out project_members rows to current members.
  getOrgMembershipList: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@clerk/backend", () => ({
  verifyToken: mocks.verifyToken,
  createClerkClient: () => ({
    users: {
      getOrganizationMembershipList: mocks.getOrganizationMembershipList,
      getUser: mocks.getUser,
    },
    organizations: {
      getOrganizationMembershipList: mocks.getOrgMembershipList,
    },
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
    orgId: string | null;
    creatorUserId: string;
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
      creatorUserId: values.creatorUserId,
      name: values.name,
      slug: values.slug,
      gitRepoUrl: values.gitRepoUrl ?? null,
      primaryBranch: values.primaryBranch ?? "main",
    })
    .returning();
  if (!row) throw new Error("insertProject: no row returned");
  return row;
}

function listUrl(orgId?: string): string {
  const payload = orgId === undefined ? {} : { orgId };
  const input = encodeURIComponent(JSON.stringify(payload));
  return `/trpc/projects.list?input=${input}`;
}

function getBySlugUrl(args: { orgId?: string; slug: string }): string {
  const input = encodeURIComponent(JSON.stringify(args));
  return `/trpc/projects.getBySlug?input=${input}`;
}

interface CreateInput {
  orgId?: string;
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

    const older = await insertProject(db, {
      orgId: org.id,
      creatorUserId: user.id,
      name: "Older",
      slug: "older",
    });
    // Force a distinguishable createdAt so ordering is deterministic across fast inserts.
    await db
      .update(schema.projects)
      .set({ createdAt: new Date(older.createdAt.getTime() - 60_000) })
      .where(eq(schema.projects.id, older.id));
    const newer = await insertProject(db, {
      orgId: org.id,
      creatorUserId: user.id,
      name: "Newer",
      slug: "newer",
    });

    // Make the caller a project admin on `newer`, leave `older` with no
    // explicit membership. Pre-1.33, the LEFT JOIN produced myRole=null on
    // `older`. Post-1.33, the auth-plugin backstop fans out an `editor` row
    // before the procedure runs, so org members are always project members.
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
    const { org: orgItems } = res.json().result.data;
    expect(orgItems).toHaveLength(2);
    expect(orgItems[0].id).toBe(newer.id);
    expect(orgItems[1].id).toBe(older.id);
    expect(orgItems[0]).toMatchObject({
      orgId: org.id,
      name: "Newer",
      slug: "newer",
      primaryBranch: "main",
      gitRepoUrl: null,
      myRole: "admin",
    });
    // ON CONFLICT DO NOTHING preserves the explicit admin row above; the
    // backstop only mints the missing `older` membership as editor.
    expect(orgItems[1].myRole).toBe("editor");
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
    expect(res.json().result.data).toEqual({ personal: [], org: [] });
  });

  test("non-member of org → FORBIDDEN, not 200 with empty list", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_list_other" });
    const owner = await seedUser(db, { clerkUserId: "user_list_owner" });
    await insertProject(db, {
      orgId: org.id,
      creatorUserId: owner.id,
      name: "Secret",
      slug: "secret",
    });

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
    const otherOwner = await seedUser(db, { clerkUserId: "user_list_other_owner" });
    await insertProject(db, {
      orgId: otherOrg.id,
      creatorUserId: otherOwner.id,
      name: "Theirs",
      slug: "theirs",
    });

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

  test("personal-only mode (no orgId) → 200, returns only caller's personal projects", async () => {
    const db = await getIntegrationDb();
    const user = await seedUser(db, { clerkUserId: "user_list_personal" });
    const otherUser = await seedUser(db, { clerkUserId: "user_list_personal_other" });

    const mine = await insertProject(db, {
      orgId: null,
      creatorUserId: user.id,
      name: "Mine",
      slug: "mine",
    });
    await db.insert(schema.projectMembers).values({
      projectId: mine.id,
      userId: user.id,
      role: "admin",
    });
    // Another user's personal project must not leak.
    await insertProject(db, {
      orgId: null,
      creatorUserId: otherUser.id,
      name: "Theirs",
      slug: "theirs",
    });

    mockAuth({ clerkUserId: user.clerkUserId, memberships: [] });

    const res = await server.inject({
      method: "GET",
      url: listUrl(),
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().result.data;
    expect(data.personal).toHaveLength(1);
    expect(data.personal[0]).toMatchObject({
      id: mine.id,
      orgId: null,
      creatorUserId: user.id,
      slug: "mine",
      myRole: "admin",
    });
    expect(data.org).toEqual([]);
  });

  test("with active org → 200, returns both personal and org sections", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_list_dual" });
    const user = await seedUser(db, { clerkUserId: "user_list_dual" });

    const personal = await insertProject(db, {
      orgId: null,
      creatorUserId: user.id,
      name: "Personal",
      slug: "personal-1",
    });
    await db.insert(schema.projectMembers).values({
      projectId: personal.id,
      userId: user.id,
      role: "admin",
    });
    const orgProject = await insertProject(db, {
      orgId: org.id,
      creatorUserId: user.id,
      name: "OrgScoped",
      slug: "org-scoped",
    });
    await db.insert(schema.projectMembers).values({
      projectId: orgProject.id,
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
    const data = res.json().result.data;
    expect(data.personal.map((p: { id: string }) => p.id)).toEqual([personal.id]);
    expect(data.org.map((p: { id: string }) => p.id)).toEqual([orgProject.id]);
  });

  test("missing Authorization → 401 UNAUTHORIZED", async () => {
    const res = await server.inject({
      method: "GET",
      url: listUrl("org_anything"),
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  test("missing Authorization on personal mode → 401 UNAUTHORIZED", async () => {
    const res = await server.inject({ method: "GET", url: listUrl() });
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
    const project = await insertProject(db, {
      orgId: org.id,
      creatorUserId: user.id,
      name: "Demo",
      slug: "demo",
    });
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
      url: getBySlugUrl({ orgId: org.clerkOrgId, slug: "demo" }),
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

  test("org member with no explicit project_members row → 200, backstop mints editor", async () => {
    // Pre-1.33 this returned myRole=null via LEFT JOIN; post-1.33 the auth
    // plugin's project_members backstop fans out an editor row on the first
    // authenticated request so invited teammates can see annotations.
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_slug_orgonly" });
    const owner = await seedUser(db, { clerkUserId: "user_slug_owner" });
    const user = await seedUser(db, { clerkUserId: "user_slug_orgonly" });
    await insertProject(db, {
      orgId: org.id,
      creatorUserId: owner.id,
      name: "Demo",
      slug: "orgonly",
    });

    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "GET",
      url: getBySlugUrl({ orgId: org.clerkOrgId, slug: "orgonly" }),
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().result.data.myRole).toBe("editor");
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
      url: getBySlugUrl({ orgId: org.clerkOrgId, slug: "does-not-exist" }),
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.data.code).toBe("NOT_FOUND");
  });

  test("non-member of org → FORBIDDEN, doesn't leak project existence", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_slug_secret" });
    const owner = await seedUser(db, { clerkUserId: "user_slug_secret_owner" });
    await insertProject(db, {
      orgId: org.id,
      creatorUserId: owner.id,
      name: "Secret",
      slug: "secret",
    });

    const user = await seedUser(db, { clerkUserId: "user_slug_outsider" });
    mockAuth({ clerkUserId: user.clerkUserId, memberships: [] });

    const res = await server.inject({
      method: "GET",
      url: getBySlugUrl({ orgId: org.clerkOrgId, slug: "secret" }),
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.data.code).toBe("FORBIDDEN");
  });

  test("same slug across orgs resolves per-org (no cross-org leak)", async () => {
    const db = await getIntegrationDb();
    const myOrg = await seedOrg(db, { clerkOrgId: "org_slug_mine" });
    const otherOrg = await seedOrg(db, { clerkOrgId: "org_slug_theirs" });
    const owner = await seedUser(db, { clerkUserId: "user_slug_cross_owner" });
    const mine = await insertProject(db, {
      orgId: myOrg.id,
      creatorUserId: owner.id,
      name: "Mine",
      slug: "shared",
    });
    await insertProject(db, {
      orgId: otherOrg.id,
      creatorUserId: owner.id,
      name: "Theirs",
      slug: "shared",
    });

    const user = await seedUser(db, { clerkUserId: "user_slug_cross" });
    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: myOrg.clerkOrgId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "GET",
      url: getBySlugUrl({ orgId: myOrg.clerkOrgId, slug: "shared" }),
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().result.data.id).toBe(mine.id);
  });

  test("personal scope (no orgId) → 200, returns caller's personal project", async () => {
    const db = await getIntegrationDb();
    const user = await seedUser(db, { clerkUserId: "user_slug_personal" });
    const project = await insertProject(db, {
      orgId: null,
      creatorUserId: user.id,
      name: "MyDemo",
      slug: "my-demo",
    });
    await db.insert(schema.projectMembers).values({
      projectId: project.id,
      userId: user.id,
      role: "admin",
    });

    mockAuth({ clerkUserId: user.clerkUserId, memberships: [] });

    const res = await server.inject({
      method: "GET",
      url: getBySlugUrl({ slug: "my-demo" }),
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().result.data).toMatchObject({
      id: project.id,
      orgId: null,
      creatorUserId: user.id,
      slug: "my-demo",
      myRole: "admin",
    });
  });

  test("personal scope cannot reach another user's personal project → NOT_FOUND", async () => {
    const db = await getIntegrationDb();
    const owner = await seedUser(db, { clerkUserId: "user_slug_personal_owner" });
    const otherOwner = await seedUser(db, { clerkUserId: "user_slug_personal_other" });
    await insertProject(db, {
      orgId: null,
      creatorUserId: otherOwner.id,
      name: "Theirs",
      slug: "theirs",
    });

    mockAuth({ clerkUserId: owner.clerkUserId, memberships: [] });

    const res = await server.inject({
      method: "GET",
      url: getBySlugUrl({ slug: "theirs" }),
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.data.code).toBe("NOT_FOUND");
  });

  test("personal slug coexists with same slug in caller's org (resolved by scope)", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_slug_coexist" });
    const user = await seedUser(db, { clerkUserId: "user_slug_coexist" });

    const personal = await insertProject(db, {
      orgId: null,
      creatorUserId: user.id,
      name: "PersonalShared",
      slug: "shared",
    });
    await db.insert(schema.projectMembers).values({
      projectId: personal.id,
      userId: user.id,
      role: "admin",
    });
    const orgProj = await insertProject(db, {
      orgId: org.id,
      creatorUserId: user.id,
      name: "OrgShared",
      slug: "shared",
    });
    await db.insert(schema.projectMembers).values({
      projectId: orgProj.id,
      userId: user.id,
      role: "admin",
    });

    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:admin" }],
    });
    const orgRes = await server.inject({
      method: "GET",
      url: getBySlugUrl({ orgId: org.clerkOrgId, slug: "shared" }),
      headers: { authorization: BEARER },
    });
    expect(orgRes.statusCode).toBe(200);
    expect(orgRes.json().result.data.id).toBe(orgProj.id);

    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:admin" }],
    });
    const personalRes = await server.inject({
      method: "GET",
      url: getBySlugUrl({ slug: "shared" }),
      headers: { authorization: BEARER },
    });
    expect(personalRes.statusCode).toBe(200);
    expect(personalRes.json().result.data.id).toBe(personal.id);
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
    // Default: fan-out finds no other members, so the creator's `admin` row is
    // the only project_members write. Tests that want to exercise the fan-out
    // override with their own clerkUserId list.
    mocks.getOrgMembershipList.mockResolvedValue({ data: [] });
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
    const otherOrg = await seedOrg(await getIntegrationDb(), { clerkOrgId: "org_create_other" });
    const user = await seedUser(await getIntegrationDb(), { clerkUserId: "user_create_outsider" });
    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: otherOrg.clerkOrgId, role: "org:admin" }],
    });

    const res = await invokeCreate(
      server,
      { orgId: "org_create_target_unknown", input: { name: "Acme", slug: "acme" } },
      true
    );

    expect(res.statusCode).toBe(403);
    expect(res.json().error.data.code).toBe("FORBIDDEN");
  });

  test("personal project (no orgId) → 200, single creator-admin row, no Clerk fan-out", async () => {
    const db = await getIntegrationDb();
    const user = await seedUser(db, { clerkUserId: "user_create_personal" });

    mockAuth({ clerkUserId: user.clerkUserId, memberships: [] });

    const res = await invokeCreate(
      server,
      { input: { name: "MyProject", slug: "my-project" } },
      true
    );

    expect(res.statusCode).toBe(200);
    const body = res.json().result.data;
    expect(body).toMatchObject({
      orgId: null,
      creatorUserId: user.id,
      name: "MyProject",
      slug: "my-project",
      myRole: "admin",
    });

    // Personal create skips Clerk fan-out entirely.
    expect(mocks.getOrgMembershipList).not.toHaveBeenCalled();

    const memberRows = await db.query.projectMembers.findMany({
      where: eq(schema.projectMembers.projectId, body.id),
    });
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0]).toMatchObject({ userId: user.id, role: "admin" });
  });

  test("two users can both create personal projects with the same slug", async () => {
    const db = await getIntegrationDb();
    const userA = await seedUser(db, { clerkUserId: "user_personal_a" });
    const userB = await seedUser(db, { clerkUserId: "user_personal_b" });

    mockAuth({ clerkUserId: userA.clerkUserId, memberships: [] });
    const a = await invokeCreate(server, { input: { name: "A", slug: "shared" } }, true);
    expect(a.statusCode).toBe(200);

    mockAuth({ clerkUserId: userB.clerkUserId, memberships: [] });
    const b = await invokeCreate(server, { input: { name: "B", slug: "shared" } }, true);
    expect(b.statusCode).toBe(200);
  });

  test("same user cannot create two personal projects with the same slug → CONFLICT", async () => {
    const db = await getIntegrationDb();
    const user = await seedUser(db, { clerkUserId: "user_personal_dup" });

    mockAuth({ clerkUserId: user.clerkUserId, memberships: [] });
    const first = await invokeCreate(server, { input: { name: "First", slug: "dup" } }, true);
    expect(first.statusCode).toBe(200);

    mockAuth({ clerkUserId: user.clerkUserId, memberships: [] });
    const second = await invokeCreate(server, { input: { name: "Second", slug: "dup" } }, true);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.data.code).toBe("CONFLICT");
  });

  test("personal slug `foo` coexists with same slug in user's org", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_personal_coexist" });
    const user = await seedUser(db, { clerkUserId: "user_personal_coexist" });

    mockAuth({ clerkUserId: user.clerkUserId, memberships: [] });
    const personal = await invokeCreate(
      server,
      { input: { name: "Personal Foo", slug: "foo" } },
      true
    );
    expect(personal.statusCode).toBe(200);

    mockAuth({
      clerkUserId: user.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:admin" }],
    });
    const orgScoped = await invokeCreate(
      server,
      { orgId: org.clerkOrgId, input: { name: "Org Foo", slug: "foo" } },
      true
    );
    expect(orgScoped.statusCode).toBe(200);
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

  // Covers task 1.33: when a project is created in an org that already has
  // teammates, every current Clerk org member ends up in project_members so
  // the new project is immediately visible (and editable) to them — not just
  // on their next webhook-driven sync.
  test("fans out editor rows to all other current Clerk org members", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_create_fanout" });
    const creator = await seedUser(db, { clerkUserId: "user_fanout_creator" });
    const teammate = await seedUser(db, { clerkUserId: "user_fanout_teammate" });

    // Creator is the auth caller; teammate is an existing org member who
    // didn't initiate the create. Clerk's org membership list returns both,
    // and createProject's fan-out skips the creator (admin row wins) and
    // inserts an `editor` row for the teammate.
    mockAuth({
      clerkUserId: creator.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:admin" }],
    });
    mocks.getOrgMembershipList.mockReset();
    mocks.getOrgMembershipList.mockResolvedValueOnce({
      data: [
        { publicUserData: { userId: creator.clerkUserId } },
        { publicUserData: { userId: teammate.clerkUserId } },
      ],
    });

    const res = await invokeCreate(
      server,
      { orgId: org.clerkOrgId, input: { name: "Shared", slug: "shared" } },
      true
    );
    expect(res.statusCode).toBe(200);
    const projectId = res.json().result.data.id as string;

    const rows = await db.query.projectMembers.findMany({
      where: eq(schema.projectMembers.projectId, projectId),
    });
    const byUserId = new Map(rows.map((r) => [r.userId, r.role]));
    expect(byUserId.get(creator.id)).toBe("admin");
    expect(byUserId.get(teammate.id)).toBe("editor");
    expect(byUserId.size).toBe(2);
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
    creatorUserId: user.id,
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
    await insertProject(db, {
      orgId: org.id,
      creatorUserId: user.id,
      name: "Other",
      slug: "taken",
    });
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

  test("personal-project creator can delete; another user cannot reach it (NOT_FOUND)", async () => {
    const db = await getIntegrationDb();
    const owner = await seedUser(db, { clerkUserId: "user_personal_delete_owner" });
    const stranger = await seedUser(db, { clerkUserId: "user_personal_delete_stranger" });
    const project = await insertProject(db, {
      orgId: null,
      creatorUserId: owner.id,
      name: "Mine",
      slug: "delete-me",
    });
    await db.insert(schema.projectMembers).values({
      projectId: project.id,
      userId: owner.id,
      role: "admin",
    });

    // Stranger sees a 404 — personal projects don't leak existence to other users.
    mockAuth({ clerkUserId: stranger.clerkUserId, memberships: [] });
    const strangerRes = await server.inject({
      method: "POST",
      url: "/trpc/projects.delete",
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { projectId: project.id },
    });
    expect(strangerRes.statusCode).toBe(404);

    // Owner can delete.
    mockAuth({ clerkUserId: owner.clerkUserId, memberships: [] });
    const ownerRes = await server.inject({
      method: "POST",
      url: "/trpc/projects.delete",
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { projectId: project.id },
    });
    expect(ownerRes.statusCode).toBe(200);

    const remaining = await db.query.projects.findMany({
      where: eq(schema.projects.id, project.id),
    });
    expect(remaining).toHaveLength(0);
  });
});

interface SeededPersonalProject {
  user: typeof schema.users.$inferSelect;
  project: typeof schema.projects.$inferSelect;
}

async function seedPersonalProject(
  db: Awaited<ReturnType<typeof getIntegrationDb>>,
  args: { clerkSuffix: string; slug?: string }
): Promise<SeededPersonalProject> {
  const user = await seedUser(db, { clerkUserId: `user_${args.clerkSuffix}` });
  const project = await insertProject(db, {
    orgId: null,
    creatorUserId: user.id,
    name: "Personal",
    slug: args.slug ?? `personal-${args.clerkSuffix}`,
  });
  await db.insert(schema.projectMembers).values({
    projectId: project.id,
    userId: user.id,
    role: "admin",
  });
  return { user, project };
}

describe("tRPC projects.transferToOrg (integration)", () => {
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

  test("creator + target-org admin → 200, project moved and members fanned out", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_transfer_happy" });
    const { user: creator, project } = await seedPersonalProject(db, {
      clerkSuffix: "transfer_happy",
    });
    const teammate = await seedUser(db, { clerkUserId: "user_transfer_teammate" });

    mockAuth({
      clerkUserId: creator.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:admin" }],
    });
    mocks.getOrgMembershipList.mockResolvedValueOnce({
      data: [
        { publicUserData: { userId: creator.clerkUserId } },
        { publicUserData: { userId: teammate.clerkUserId } },
      ],
    });

    const res = await server.inject({
      method: "POST",
      url: "/trpc/projects.transferToOrg",
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { projectId: project.id, targetClerkOrgId: org.clerkOrgId },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json().result.data;
    expect(body).toMatchObject({ id: project.id, orgId: org.id, myRole: "admin" });

    const rows = await db.query.projectMembers.findMany({
      where: eq(schema.projectMembers.projectId, project.id),
    });
    const byUserId = new Map(rows.map((r) => [r.userId, r.role]));
    expect(byUserId.get(creator.id)).toBe("admin");
    expect(byUserId.get(teammate.id)).toBe("editor");
    expect(byUserId.size).toBe(2);
  });

  test("non-creator (even if target-org admin) → NOT_FOUND, existence not leaked", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_transfer_noncreator" });
    const { project } = await seedPersonalProject(db, { clerkSuffix: "transfer_noncreator" });
    const stranger = await seedUser(db, { clerkUserId: "user_transfer_stranger" });

    mockAuth({
      clerkUserId: stranger.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:admin" }],
    });
    mocks.getOrgMembershipList.mockResolvedValueOnce({
      data: [{ publicUserData: { userId: stranger.clerkUserId } }],
    });

    const res = await server.inject({
      method: "POST",
      url: "/trpc/projects.transferToOrg",
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { projectId: project.id, targetClerkOrgId: org.clerkOrgId },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.data.code).toBe("NOT_FOUND");
  });

  test("creator without org:admin in target org → FORBIDDEN", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_transfer_member" });
    const { user: creator, project } = await seedPersonalProject(db, {
      clerkSuffix: "transfer_member",
    });

    mockAuth({
      clerkUserId: creator.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:member" }],
    });

    const res = await server.inject({
      method: "POST",
      url: "/trpc/projects.transferToOrg",
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { projectId: project.id, targetClerkOrgId: org.clerkOrgId },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.data.code).toBe("FORBIDDEN");
  });

  test("slug already exists in target org → CONFLICT", async () => {
    const db = await getIntegrationDb();
    const org = await seedOrg(db, { clerkOrgId: "org_transfer_collide" });
    const { user: creator, project } = await seedPersonalProject(db, {
      clerkSuffix: "transfer_collide",
      slug: "collide",
    });
    // Pre-existing org project with the same slug.
    await insertProject(db, {
      orgId: org.id,
      creatorUserId: creator.id,
      name: "Collide",
      slug: "collide",
    });

    mockAuth({
      clerkUserId: creator.clerkUserId,
      memberships: [{ clerkOrgId: org.clerkOrgId, role: "org:admin" }],
    });
    mocks.getOrgMembershipList.mockResolvedValueOnce({
      data: [{ publicUserData: { userId: creator.clerkUserId } }],
    });

    const res = await server.inject({
      method: "POST",
      url: "/trpc/projects.transferToOrg",
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { projectId: project.id, targetClerkOrgId: org.clerkOrgId },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.data.code).toBe("CONFLICT");

    // Project remains personal — transfer txn rolled back on the unique violation.
    const reloaded = await db.query.projects.findFirst({
      where: eq(schema.projects.id, project.id),
      columns: { orgId: true },
    });
    expect(reloaded?.orgId).toBeNull();
  });

  test("project already belongs to an organization → CONFLICT", async () => {
    const db = await getIntegrationDb();
    const sourceOrg = await seedOrg(db, { clerkOrgId: "org_transfer_source" });
    const targetOrg = await seedOrg(db, { clerkOrgId: "org_transfer_target" });
    const creator = await seedUser(db, { clerkUserId: "user_transfer_orgproj" });
    const project = await insertProject(db, {
      orgId: sourceOrg.id,
      creatorUserId: creator.id,
      name: "Already",
      slug: "already-in-org",
    });
    await db.insert(schema.projectMembers).values({
      projectId: project.id,
      userId: creator.id,
      role: "admin",
    });

    mockAuth({
      clerkUserId: creator.clerkUserId,
      memberships: [
        { clerkOrgId: sourceOrg.clerkOrgId, role: "org:admin" },
        { clerkOrgId: targetOrg.clerkOrgId, role: "org:admin" },
      ],
    });

    const res = await server.inject({
      method: "POST",
      url: "/trpc/projects.transferToOrg",
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: { projectId: project.id, targetClerkOrgId: targetOrg.clerkOrgId },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.data.code).toBe("CONFLICT");
  });

  test("missing Authorization → UNAUTHORIZED", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/trpc/projects.transferToOrg",
      headers: { "content-type": "application/json" },
      payload: {
        projectId: "00000000-0000-0000-0000-000000000000",
        targetClerkOrgId: "org_anything",
      },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});
