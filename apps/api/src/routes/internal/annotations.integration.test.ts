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

async function seedProjectAndUser(db: Db): Promise<{
  project: typeof schema.projects.$inferSelect;
  user: typeof schema.users.$inferSelect;
  branch: typeof schema.branches.$inferSelect;
}> {
  const org = await seedOrg(db);
  const user = await seedUser(db);
  const [project] = await db
    .insert(schema.projects)
    .values({
      orgId: org.id,
      name: `Project ${rand()}`,
      slug: `proj-${rand()}`,
      primaryBranch: "main",
    })
    .returning();
  if (!project) throw new Error("seed: project insert returned no rows");
  const [branch] = await db
    .insert(schema.branches)
    .values({ projectId: project.id, name: "main" })
    .returning();
  if (!branch) throw new Error("seed: branch insert returned no rows");
  return { project, user, branch };
}

async function seedProjectToken(
  db: Db,
  args: { projectId: string; userId: string }
): Promise<typeof schema.projectApiTokens.$inferSelect> {
  const [row] = await db
    .insert(schema.projectApiTokens)
    .values({
      projectId: args.projectId,
      name: `agent-${rand()}`,
      tokenHash: `hash_${rand()}_${rand()}`,
      tokenPrefix: "rmk_live_xxx",
      tokenLast4: "abcd",
      scopes: ["tasks:read", "tasks:write", "project:read"],
      createdById: args.userId,
    })
    .returning();
  if (!row) throw new Error("seed: project_api_tokens insert returned no rows");
  return row;
}

async function seedAnnotation(
  db: Db,
  args: {
    projectId: string;
    branchId: string;
    authorId: string;
    url?: string;
    targetSelector?: string | null;
    commentText?: string;
    createdAt?: Date;
    status?: typeof schema.annotations.$inferSelect.status;
  }
): Promise<typeof schema.annotations.$inferSelect> {
  const [row] = await db
    .insert(schema.annotations)
    .values({
      projectId: args.projectId,
      branchId: args.branchId,
      authorId: args.authorId,
      status: args.status ?? "to_do",
      targetType: "element",
      url: args.url ?? "https://example.test/page",
      // Distinguish "caller passed null" (rectangle/route mode) from "caller
      // omitted the key" (default to a stable selector for element-mode tests).
      targetSelector: args.targetSelector === undefined ? "button.primary" : args.targetSelector,
      targetCoords: null,
      viewport: { width: 1280, height: 720, dpr: 1 },
      domContext: null,
      frameworkHint: null,
      commentText: args.commentText ?? "Make this blue",
      ...(args.createdAt ? { createdAt: args.createdAt } : {}),
    })
    .returning();
  if (!row) throw new Error("seed: annotation insert returned no rows");
  return row;
}

describe("GET /internal/mcp/annotations/:annotationId (integration)", () => {
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

  test("returns annotation + URL- and selector-related tasks ordered by createdAt ASC", async () => {
    const db = await getIntegrationDb();
    const { project, user, branch } = await seedProjectAndUser(db);

    const target = await seedAnnotation(db, {
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
      url: "https://example.test/checkout",
      targetSelector: "button.submit",
      commentText: "Use brand green not purple",
      createdAt: new Date("2026-04-26T10:00:00Z"),
    });
    const sameUrl = await seedAnnotation(db, {
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
      url: "https://example.test/checkout",
      targetSelector: "div.banner",
      commentText: "Add a shadow",
      createdAt: new Date("2026-04-26T10:01:00Z"),
    });
    const sameSelector = await seedAnnotation(db, {
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
      url: "https://example.test/profile",
      targetSelector: "button.submit",
      commentText: "Same selector different page",
      createdAt: new Date("2026-04-26T10:02:00Z"),
    });
    const unrelated = await seedAnnotation(db, {
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
      url: "https://example.test/other",
      targetSelector: "a.link",
    });

    const res = await server.inject({
      method: "GET",
      url: `/internal/mcp/annotations/${target.id}?projectId=${project.id}`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.annotation.id).toBe(target.id);
    expect(body.annotation.commentText).toBe("Use brand green not purple");

    const relatedIds: string[] = body.relatedTasks.map((r: { id: string }) => r.id);
    expect(relatedIds).toContain(sameUrl.id);
    expect(relatedIds).toContain(sameSelector.id);
    expect(relatedIds).not.toContain(unrelated.id);
    expect(relatedIds).not.toContain(target.id);
    // Ordered by createdAt ASC
    expect(relatedIds.indexOf(sameUrl.id)).toBeLessThan(relatedIds.indexOf(sameSelector.id));
  });

  test("cross-project access → 404 NOT_FOUND", async () => {
    const db = await getIntegrationDb();
    const { project, user, branch } = await seedProjectAndUser(db);
    const annotation = await seedAnnotation(db, {
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
    });

    // Use a different (random) project id in the query string.
    const res = await server.inject({
      method: "GET",
      url: `/internal/mcp/annotations/${annotation.id}?projectId=00000000-0000-0000-0000-000000000000`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  test("missing annotation → 404 NOT_FOUND", async () => {
    const db = await getIntegrationDb();
    const { project } = await seedProjectAndUser(db);

    const res = await server.inject({
      method: "GET",
      url: `/internal/mcp/annotations/00000000-0000-0000-0000-000000000000?projectId=${project.id}`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  test("rectangle annotation (null selector) only matches by URL", async () => {
    const db = await getIntegrationDb();
    const { project, user, branch } = await seedProjectAndUser(db);

    const target = await seedAnnotation(db, {
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
      url: "https://example.test/page",
      targetSelector: null,
    });
    const sameUrl = await seedAnnotation(db, {
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
      url: "https://example.test/page",
      targetSelector: "button.x",
    });
    // Another null-selector on a different URL — must NOT match (we'd otherwise
    // pull every selector-less annotation on the project).
    const otherNull = await seedAnnotation(db, {
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
      url: "https://example.test/different",
      targetSelector: null,
    });

    const res = await server.inject({
      method: "GET",
      url: `/internal/mcp/annotations/${target.id}?projectId=${project.id}`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });

    expect(res.statusCode).toBe(200);
    const ids: string[] = res.json().relatedTasks.map((r: { id: string }) => r.id);
    expect(ids).toContain(sameUrl.id);
    expect(ids).not.toContain(otherNull.id);
  });

  test("missing x-internal-auth → 401", async () => {
    const db = await getIntegrationDb();
    const { project, user, branch } = await seedProjectAndUser(db);
    const annotation = await seedAnnotation(db, {
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
    });

    const res = await server.inject({
      method: "GET",
      url: `/internal/mcp/annotations/${annotation.id}?projectId=${project.id}`,
    });

    expect(res.statusCode).toBe(401);
  });
});

describe("POST /internal/mcp/annotations/:annotationId/status (integration)", () => {
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

  test("happy path: updates status, writes agent_updated_status event with correct actor fields", async () => {
    const db = await getIntegrationDb();
    const { project, user, branch } = await seedProjectAndUser(db);
    const token = await seedProjectToken(db, { projectId: project.id, userId: user.id });
    const annotation = await seedAnnotation(db, {
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
    });

    const res = await server.inject({
      method: "POST",
      url: `/internal/mcp/annotations/${annotation.id}/status`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
      payload: {
        projectId: project.id,
        tokenId: token.id,
        status: "doing",
        note: "starting work",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ id: annotation.id, status: "doing" });
    expect(typeof body.updatedAt).toBe("string");

    const updated = await db.query.annotations.findFirst({
      where: eq(schema.annotations.id, annotation.id),
    });
    expect(updated?.status).toBe("doing");

    const events = await db.query.annotationEvents.findMany({
      where: eq(schema.annotationEvents.annotationId, annotation.id),
    });
    const agentEvent = events.find((e) => e.type === "agent_updated_status");
    expect(agentEvent).toBeDefined();
    expect(agentEvent?.actorType).toBe("agent");
    expect(agentEvent?.actorId).toBeNull();
    expect(agentEvent?.actorTokenId).toBe(token.id);
    expect(agentEvent?.payload).toEqual({ from: "to_do", to: "doing", note: "starting work" });
  });

  test("note omitted → payload has no note key", async () => {
    const db = await getIntegrationDb();
    const { project, user, branch } = await seedProjectAndUser(db);
    const token = await seedProjectToken(db, { projectId: project.id, userId: user.id });
    const annotation = await seedAnnotation(db, {
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
    });

    const res = await server.inject({
      method: "POST",
      url: `/internal/mcp/annotations/${annotation.id}/status`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
      payload: { projectId: project.id, tokenId: token.id, status: "done" },
    });

    expect(res.statusCode).toBe(200);
    const events = await db.query.annotationEvents.findMany({
      where: and(
        eq(schema.annotationEvents.annotationId, annotation.id),
        eq(schema.annotationEvents.type, "agent_updated_status")
      ),
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({ from: "to_do", to: "done" });
  });

  test("no-op (same status) → 200 without writing a new event row", async () => {
    const db = await getIntegrationDb();
    const { project, user, branch } = await seedProjectAndUser(db);
    const token = await seedProjectToken(db, { projectId: project.id, userId: user.id });
    const annotation = await seedAnnotation(db, {
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
      status: "doing",
    });

    const res = await server.inject({
      method: "POST",
      url: `/internal/mcp/annotations/${annotation.id}/status`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
      payload: { projectId: project.id, tokenId: token.id, status: "doing" },
    });

    expect(res.statusCode).toBe(200);
    const events = await db.query.annotationEvents.findMany({
      where: and(
        eq(schema.annotationEvents.annotationId, annotation.id),
        eq(schema.annotationEvents.type, "agent_updated_status")
      ),
    });
    expect(events).toHaveLength(0);
  });

  test("cross-project → 404 NOT_FOUND", async () => {
    const db = await getIntegrationDb();
    const { project, user, branch } = await seedProjectAndUser(db);
    const token = await seedProjectToken(db, { projectId: project.id, userId: user.id });
    const annotation = await seedAnnotation(db, {
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
    });

    const res = await server.inject({
      method: "POST",
      url: `/internal/mcp/annotations/${annotation.id}/status`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
      payload: {
        projectId: "00000000-0000-0000-0000-000000000000",
        tokenId: token.id,
        status: "doing",
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  test("missing annotation → 404", async () => {
    const db = await getIntegrationDb();
    const { project, user } = await seedProjectAndUser(db);
    const token = await seedProjectToken(db, { projectId: project.id, userId: user.id });

    const res = await server.inject({
      method: "POST",
      url: "/internal/mcp/annotations/00000000-0000-0000-0000-000000000000/status",
      headers: { "x-internal-auth": INTERNAL_TOKEN },
      payload: { projectId: project.id, tokenId: token.id, status: "doing" },
    });

    expect(res.statusCode).toBe(404);
  });

  test("missing x-internal-auth → 401", async () => {
    const db = await getIntegrationDb();
    const { project, user, branch } = await seedProjectAndUser(db);
    const token = await seedProjectToken(db, { projectId: project.id, userId: user.id });
    const annotation = await seedAnnotation(db, {
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
    });

    const res = await server.inject({
      method: "POST",
      url: `/internal/mcp/annotations/${annotation.id}/status`,
      payload: { projectId: project.id, tokenId: token.id, status: "doing" },
    });

    expect(res.statusCode).toBe(401);
  });

  test("invalid status (to_do) → 400 VALIDATION_ERROR", async () => {
    const db = await getIntegrationDb();
    const { project, user, branch } = await seedProjectAndUser(db);
    const token = await seedProjectToken(db, { projectId: project.id, userId: user.id });
    const annotation = await seedAnnotation(db, {
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
    });

    const res = await server.inject({
      method: "POST",
      url: `/internal/mcp/annotations/${annotation.id}/status`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
      payload: { projectId: project.id, tokenId: token.id, status: "to_do" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /internal/mcp/annotations/:annotationId/comments (integration)", () => {
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

  test("happy path: writes agent_commented event with correct payload + actor fields", async () => {
    const db = await getIntegrationDb();
    const { project, user, branch } = await seedProjectAndUser(db);
    const token = await seedProjectToken(db, { projectId: project.id, userId: user.id });
    const annotation = await seedAnnotation(db, {
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
    });

    const res = await server.inject({
      method: "POST",
      url: `/internal/mcp/annotations/${annotation.id}/comments`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
      payload: {
        projectId: project.id,
        tokenId: token.id,
        comment: "Need clarification on which shade of blue.",
        kind: "clarification_request",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(typeof body.eventId).toBe("string");
    expect(typeof body.createdAt).toBe("string");

    const event = await db.query.annotationEvents.findFirst({
      where: eq(schema.annotationEvents.id, body.eventId),
    });
    expect(event?.type).toBe("agent_commented");
    expect(event?.actorType).toBe("agent");
    expect(event?.actorId).toBeNull();
    expect(event?.actorTokenId).toBe(token.id);
    expect(event?.payload).toEqual({
      comment: "Need clarification on which shade of blue.",
      kind: "clarification_request",
    });
  });

  test("kind omitted → payload has only comment", async () => {
    const db = await getIntegrationDb();
    const { project, user, branch } = await seedProjectAndUser(db);
    const token = await seedProjectToken(db, { projectId: project.id, userId: user.id });
    const annotation = await seedAnnotation(db, {
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
    });

    const res = await server.inject({
      method: "POST",
      url: `/internal/mcp/annotations/${annotation.id}/comments`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
      payload: { projectId: project.id, tokenId: token.id, comment: "done" },
    });

    expect(res.statusCode).toBe(201);
    const event = await db.query.annotationEvents.findFirst({
      where: eq(schema.annotationEvents.id, res.json().eventId),
    });
    expect(event?.payload).toEqual({ comment: "done" });
  });

  test("cross-project → 404", async () => {
    const db = await getIntegrationDb();
    const { project, user, branch } = await seedProjectAndUser(db);
    const token = await seedProjectToken(db, { projectId: project.id, userId: user.id });
    const annotation = await seedAnnotation(db, {
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
    });

    const res = await server.inject({
      method: "POST",
      url: `/internal/mcp/annotations/${annotation.id}/comments`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
      payload: {
        projectId: "00000000-0000-0000-0000-000000000000",
        tokenId: token.id,
        comment: "x",
      },
    });

    expect(res.statusCode).toBe(404);
  });

  test("missing x-internal-auth → 401", async () => {
    const db = await getIntegrationDb();
    const { project, user, branch } = await seedProjectAndUser(db);
    const token = await seedProjectToken(db, { projectId: project.id, userId: user.id });
    const annotation = await seedAnnotation(db, {
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
    });

    const res = await server.inject({
      method: "POST",
      url: `/internal/mcp/annotations/${annotation.id}/comments`,
      payload: { projectId: project.id, tokenId: token.id, comment: "x" },
    });

    expect(res.statusCode).toBe(401);
  });

  test("comment over MAX_COMMENT_LENGTH → 400", async () => {
    const db = await getIntegrationDb();
    const { project, user, branch } = await seedProjectAndUser(db);
    const token = await seedProjectToken(db, { projectId: project.id, userId: user.id });
    const annotation = await seedAnnotation(db, {
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
    });

    const res = await server.inject({
      method: "POST",
      url: `/internal/mcp/annotations/${annotation.id}/comments`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
      payload: { projectId: project.id, tokenId: token.id, comment: "x".repeat(5001) },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});
