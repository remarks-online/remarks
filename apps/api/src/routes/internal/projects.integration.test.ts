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

vi.mock("@clerk/backend", () => ({
  verifyToken: vi.fn(),
  createClerkClient: () => ({
    users: { getOrganizationMembershipList: vi.fn(), getUser: vi.fn() },
    organizations: { getOrganizationMembershipList: vi.fn() },
  }),
}));

const { buildServer } = await import("../../server.js");

const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN as string;

type Db = Awaited<ReturnType<typeof getIntegrationDb>>;

function rand(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface SeededProject {
  project: typeof schema.projects.$inferSelect;
  user: typeof schema.users.$inferSelect;
}

async function seedProjectAndUser(db: Db): Promise<SeededProject> {
  const org = await seedOrg(db);
  const user = await seedUser(db);
  const [project] = await db
    .insert(schema.projects)
    .values({
      orgId: org.id,
      creatorUserId: user.id,
      name: `Project ${rand()}`,
      slug: `proj-${rand()}`,
      primaryBranch: "main",
    })
    .returning();
  if (!project) throw new Error("seed: project insert returned no rows");
  return { project, user };
}

async function seedBranch(
  db: Db,
  projectId: string,
  name: string
): Promise<typeof schema.branches.$inferSelect> {
  const [row] = await db.insert(schema.branches).values({ projectId, name }).returning();
  if (!row) throw new Error("seed: branch insert returned no rows");
  return row;
}

interface SeedAnnotationOverrides {
  status?: typeof schema.annotations.$inferInsert.status;
  intent?: typeof schema.annotations.$inferInsert.intent;
  severity?: typeof schema.annotations.$inferInsert.severity;
  url?: string;
  targetSelector?: string | null;
  updatedAt?: Date;
  createdAt?: Date;
  commentText?: string;
}

async function seedAnnotation(
  db: Db,
  args: {
    projectId: string;
    branchId: string;
    authorId: string;
  } & SeedAnnotationOverrides
): Promise<typeof schema.annotations.$inferSelect> {
  const [row] = await db
    .insert(schema.annotations)
    .values({
      projectId: args.projectId,
      branchId: args.branchId,
      authorId: args.authorId,
      status: args.status ?? "to_do",
      intent: args.intent ?? null,
      severity: args.severity ?? null,
      targetType: "element",
      url: args.url ?? "https://example.test/page",
      targetSelector: args.targetSelector === undefined ? "button.primary" : args.targetSelector,
      targetCoords: null,
      viewport: { width: 1280, height: 720, dpr: 1 },
      domContext: null,
      frameworkHint: null,
      commentText: args.commentText ?? "Make this blue",
      ...(args.updatedAt ? { updatedAt: args.updatedAt } : {}),
      ...(args.createdAt ? { createdAt: args.createdAt } : {}),
    })
    .returning();
  if (!row) throw new Error("seed: annotation insert returned no rows");
  return row;
}

describe("GET /internal/mcp/projects/:projectId/context (integration)", () => {
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
    await truncateAll();
  });

  test("returns project metadata and only branches with open tasks", async () => {
    const db = await getIntegrationDb();
    const { project, user } = await seedProjectAndUser(db);

    const main = await seedBranch(db, project.id, "main");
    const feat = await seedBranch(db, project.id, "feat/checkout");
    const stale = await seedBranch(db, project.id, "feat/old-shipped");

    // main: 2 open + 1 done
    await seedAnnotation(db, {
      projectId: project.id,
      branchId: main.id,
      authorId: user.id,
      status: "to_do",
    });
    await seedAnnotation(db, {
      projectId: project.id,
      branchId: main.id,
      authorId: user.id,
      status: "doing",
    });
    await seedAnnotation(db, {
      projectId: project.id,
      branchId: main.id,
      authorId: user.id,
      status: "done",
    });

    // feat/checkout: 1 open
    const featAnnotation = await seedAnnotation(db, {
      projectId: project.id,
      branchId: feat.id,
      authorId: user.id,
      status: "to_do",
      updatedAt: new Date("2026-04-26T10:00:00Z"),
    });

    // stale branch: only closed annotations — should NOT appear in active_branches
    await seedAnnotation(db, {
      projectId: project.id,
      branchId: stale.id,
      authorId: user.id,
      status: "done",
    });
    await seedAnnotation(db, {
      projectId: project.id,
      branchId: stale.id,
      authorId: user.id,
      status: "rejected",
    });

    const res = await server.inject({
      method: "GET",
      url: `/internal/mcp/projects/${project.id}/context`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.project).toEqual({
      id: project.id,
      name: project.name,
      slug: project.slug,
      primaryBranch: "main",
      gitRepoUrl: null,
    });

    const branchesByName = new Map<string, { name: string; openTaskCount: number }>(
      body.activeBranches.map((b: { name: string; openTaskCount: number }) => [b.name, b])
    );
    expect(branchesByName.has("main")).toBe(true);
    expect(branchesByName.get("main")?.openTaskCount).toBe(2);
    expect(branchesByName.has("feat/checkout")).toBe(true);
    expect(branchesByName.get("feat/checkout")?.openTaskCount).toBe(1);
    // stale is excluded — every annotation is closed
    expect(branchesByName.has("feat/old-shipped")).toBe(false);

    // last_activity is the max updatedAt for any annotation on the branch.
    const featBranch = body.activeBranches.find(
      (b: { name: string }) => b.name === "feat/checkout"
    );
    expect(new Date(featBranch.lastActivity).getTime()).toBeGreaterThanOrEqual(
      featAnnotation.updatedAt.getTime() - 1000
    );
  });

  test("project with no annotations → empty active_branches", async () => {
    const db = await getIntegrationDb();
    const { project } = await seedProjectAndUser(db);

    const res = await server.inject({
      method: "GET",
      url: `/internal/mcp/projects/${project.id}/context`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().activeBranches).toEqual([]);
  });

  test("non-existent project → 404 NOT_FOUND", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/internal/mcp/projects/00000000-0000-0000-0000-000000000000/context",
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  test("missing x-internal-auth → 401", async () => {
    const db = await getIntegrationDb();
    const { project } = await seedProjectAndUser(db);

    const res = await server.inject({
      method: "GET",
      url: `/internal/mcp/projects/${project.id}/context`,
    });

    expect(res.statusCode).toBe(401);
  });
});

describe("GET /internal/mcp/projects/:projectId/annotations (integration)", () => {
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
    await truncateAll();
  });

  test("statuses=to_do,doing returns only open annotations, paginated", async () => {
    const db = await getIntegrationDb();
    const { project, user } = await seedProjectAndUser(db);
    const main = await seedBranch(db, project.id, "main");

    // 8 open + 4 closed
    for (let i = 0; i < 4; i++) {
      await seedAnnotation(db, {
        projectId: project.id,
        branchId: main.id,
        authorId: user.id,
        status: "to_do",
      });
    }
    for (let i = 0; i < 4; i++) {
      await seedAnnotation(db, {
        projectId: project.id,
        branchId: main.id,
        authorId: user.id,
        status: "doing",
      });
    }
    for (let i = 0; i < 2; i++) {
      await seedAnnotation(db, {
        projectId: project.id,
        branchId: main.id,
        authorId: user.id,
        status: "done",
      });
    }
    for (let i = 0; i < 2; i++) {
      await seedAnnotation(db, {
        projectId: project.id,
        branchId: main.id,
        authorId: user.id,
        status: "rejected",
      });
    }

    const page1 = await server.inject({
      method: "GET",
      url: `/internal/mcp/projects/${project.id}/annotations?statuses=to_do,doing&limit=5`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });

    expect(page1.statusCode).toBe(200);
    const p1 = page1.json();
    expect(p1.items).toHaveLength(5);
    expect(p1.nextCursor).not.toBeNull();
    for (const item of p1.items) {
      expect(["to_do", "doing"]).toContain(item.status);
    }

    const page2 = await server.inject({
      method: "GET",
      url: `/internal/mcp/projects/${project.id}/annotations?statuses=to_do,doing&limit=5&cursor=${encodeURIComponent(p1.nextCursor)}`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });

    expect(page2.statusCode).toBe(200);
    const p2 = page2.json();
    // 8 open total, 5 + 3 = 8 with no overlap
    expect(p2.items).toHaveLength(3);
    expect(p2.nextCursor).toBeNull();
    const idsP1: string[] = p1.items.map((i: { id: string }) => i.id);
    const idsP2: string[] = p2.items.map((i: { id: string }) => i.id);
    for (const id of idsP2) expect(idsP1).not.toContain(id);
  });

  test("branch filter scopes results to that branch", async () => {
    const db = await getIntegrationDb();
    const { project, user } = await seedProjectAndUser(db);
    const main = await seedBranch(db, project.id, "main");
    const feat = await seedBranch(db, project.id, "feat/x");
    await seedAnnotation(db, {
      projectId: project.id,
      branchId: main.id,
      authorId: user.id,
      status: "to_do",
    });
    await seedAnnotation(db, {
      projectId: project.id,
      branchId: feat.id,
      authorId: user.id,
      status: "to_do",
    });

    const res = await server.inject({
      method: "GET",
      url: `/internal/mcp/projects/${project.id}/annotations?statuses=to_do,doing&branch=feat/x`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].branchName).toBe("feat/x");
  });

  test("intents=fix,question and severities=blocking filter independently", async () => {
    const db = await getIntegrationDb();
    const { project, user } = await seedProjectAndUser(db);
    const main = await seedBranch(db, project.id, "main");

    await seedAnnotation(db, {
      projectId: project.id,
      branchId: main.id,
      authorId: user.id,
      intent: "fix",
      severity: "blocking",
    });
    await seedAnnotation(db, {
      projectId: project.id,
      branchId: main.id,
      authorId: user.id,
      intent: "question",
      severity: "blocking",
    });
    await seedAnnotation(db, {
      projectId: project.id,
      branchId: main.id,
      authorId: user.id,
      intent: "approve",
      severity: "suggestion",
    });
    await seedAnnotation(db, {
      projectId: project.id,
      branchId: main.id,
      authorId: user.id,
      intent: "fix",
      severity: "important",
    });

    // CSV intents picks up two rows (fix + question), severity narrows to one.
    const res = await server.inject({
      method: "GET",
      url: `/internal/mcp/projects/${project.id}/annotations?intents=fix,question&severities=blocking`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(2);
    for (const item of body.items) {
      expect(["fix", "question"]).toContain(item.intent);
      expect(item.severity).toBe("blocking");
    }
  });

  test("no statuses param → no status filter (returns all)", async () => {
    const db = await getIntegrationDb();
    const { project, user } = await seedProjectAndUser(db);
    const main = await seedBranch(db, project.id, "main");
    await seedAnnotation(db, {
      projectId: project.id,
      branchId: main.id,
      authorId: user.id,
      status: "to_do",
    });
    await seedAnnotation(db, {
      projectId: project.id,
      branchId: main.id,
      authorId: user.id,
      status: "done",
    });

    const res = await server.inject({
      method: "GET",
      url: `/internal/mcp/projects/${project.id}/annotations`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(2);
  });
});
