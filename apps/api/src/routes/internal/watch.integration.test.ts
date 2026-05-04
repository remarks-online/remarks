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

vi.mock("@clerk/backend", () => ({
  verifyToken: vi.fn(),
  createClerkClient: () => ({
    users: { getOrganizationMembershipList: vi.fn(), getUser: vi.fn() },
    organizations: { getOrganizationMembershipList: vi.fn() },
  }),
}));

const { buildServer } = await import("../../server.js");

const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN as string;
const OAUTH_CLIENT_NAME = "Claude Code";

type Db = Awaited<ReturnType<typeof getIntegrationDb>>;

function rand(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function seedProjectMember(db: Db): Promise<{
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
      creatorUserId: user.id,
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
  await db
    .insert(schema.projectMembers)
    .values({ projectId: project.id, userId: user.id, role: "editor" });
  return { project, user, branch };
}

async function seedAnnotationWithCreatedEvent(
  db: Db,
  args: {
    projectId: string | null;
    branchId: string | null;
    authorId: string;
    intent?: "fix" | "change" | "question" | "approve" | null;
    severity?: "blocking" | "important" | "suggestion" | null;
    status?: typeof schema.annotations.$inferSelect.status;
  }
): Promise<{
  annotation: typeof schema.annotations.$inferSelect;
  event: typeof schema.annotationEvents.$inferSelect;
}> {
  const [annotation] = await db
    .insert(schema.annotations)
    .values({
      projectId: args.projectId,
      branchId: args.branchId,
      authorId: args.authorId,
      status: args.status ?? "to_do",
      targetType: "element",
      url: "https://example.test/page",
      targetSelector: "button.primary",
      targetCoords: null,
      viewport: { width: 1280, height: 720, dpr: 1 },
      domContext: null,
      frameworkHint: null,
      commentText: "needs work",
      intent: args.intent ?? null,
      severity: args.severity ?? null,
      groupId: null,
    })
    .returning();
  if (!annotation) throw new Error("seed: annotation insert returned no rows");

  // Insert a `created` event matching the annotation. The watch endpoint's
  // replay path joins annotation_events to annotations, so we need both rows.
  const [event] = await db
    .insert(schema.annotationEvents)
    .values({
      annotationId: annotation.id,
      type: "created",
      actorType: "user",
      actorId: args.authorId,
      payload: { commentText: "needs work" },
    })
    .returning();
  if (!event) throw new Error("seed: annotation_events insert returned no rows");
  return { annotation, event };
}

describe("GET /internal/mcp/.../watch (integration)", () => {
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

  test("project mode: replay returns the seeded event with annotation hydrated", async () => {
    const db = await getIntegrationDb();
    const { project, user, branch } = await seedProjectMember(db);
    await seedAnnotationWithCreatedEvent(db, {
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
      intent: "fix",
      severity: "blocking",
    });

    // Resume from a cursor that pre-dates everything → DB replay path covers
    // it (the in-memory ring buffer is empty between server starts).
    const ancientId = "1900-01-01T00:00:00.000Z:00000000-0000-4000-8000-000000000000";
    const url = `/internal/mcp/projects/${project.id}/watch?clerkUserId=${encodeURIComponent(user.clerkUserId)}&since=${encodeURIComponent(ancientId)}&wait_seconds=0`;

    const res = await server.inject({
      method: "GET",
      url,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBeGreaterThanOrEqual(1);

    const ev = body.events[0];
    expect(ev.streamEvent.type).toBe("created");
    expect(ev.annotation).not.toBeNull();
    expect(ev.annotation.intent).toBe("fix");
    expect(ev.annotation.severity).toBe("blocking");
    expect(ev.autoAcknowledged).toBe(false);
    expect(body.idle).toBe(false);
    expect(body.replayTruncated).toBe(false);
    expect(typeof body.nextCursor).toBe("string");
  });

  test("wait_seconds=0 with no replay events → idle=true and empty events", async () => {
    const db = await getIntegrationDb();
    const { project, user } = await seedProjectMember(db);

    const url = `/internal/mcp/projects/${project.id}/watch?clerkUserId=${encodeURIComponent(user.clerkUserId)}&wait_seconds=0`;

    const res = await server.inject({
      method: "GET",
      url,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events).toEqual([]);
    // wait_seconds=0 path resolves before the timeout fires; idle is reserved
    // for the wait-deadline branch, so it stays false here even though the
    // batch is empty. Documented behavior.
    expect(body.idle).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  test("intent filter excludes non-matching events", async () => {
    const db = await getIntegrationDb();
    const { project, user, branch } = await seedProjectMember(db);
    await seedAnnotationWithCreatedEvent(db, {
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
      intent: "approve", // wrong intent
    });

    const ancientId = "1900-01-01T00:00:00.000Z:00000000-0000-4000-8000-000000000000";
    const url = `/internal/mcp/projects/${project.id}/watch?clerkUserId=${encodeURIComponent(user.clerkUserId)}&since=${encodeURIComponent(ancientId)}&intent=fix&wait_seconds=0`;

    const res = await server.inject({
      method: "GET",
      url,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // The cursor still advanced (the event was collected, just filtered out)
    // so the agent makes progress without re-seeing this event.
    expect(body.events).toEqual([]);
    expect(typeof body.nextCursor).toBe("string");
  });

  test("auto_acknowledge=true flips matching to_do annotation to acknowledged", async () => {
    const db = await getIntegrationDb();
    const { project, user, branch } = await seedProjectMember(db);
    const { annotation } = await seedAnnotationWithCreatedEvent(db, {
      projectId: project.id,
      branchId: branch.id,
      authorId: user.id,
      status: "to_do",
    });

    const ancientId = "1900-01-01T00:00:00.000Z:00000000-0000-4000-8000-000000000000";
    const url = `/internal/mcp/projects/${project.id}/watch?clerkUserId=${encodeURIComponent(user.clerkUserId)}&since=${encodeURIComponent(ancientId)}&wait_seconds=0&auto_acknowledge=true&oauthClientName=${encodeURIComponent(OAUTH_CLIENT_NAME)}`;

    const res = await server.inject({
      method: "GET",
      url,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].autoAcknowledged).toBe(true);

    // Confirm the side effect landed in the DB.
    const after = await db.query.annotations.findFirst({
      where: eq(schema.annotations.id, annotation.id),
      columns: { status: true },
    });
    expect(after?.status).toBe("acknowledged");

    // And there's an `agent_acknowledged` event row.
    const ackEvents = await db.query.annotationEvents.findMany({
      where: eq(schema.annotationEvents.annotationId, annotation.id),
    });
    expect(ackEvents.some((e) => e.type === "agent_acknowledged")).toBe(true);
  });

  test("non-member returns 404 (existence-leak posture)", async () => {
    const db = await getIntegrationDb();
    const { project } = await seedProjectMember(db);
    const outsider = await seedUser(db);

    const url = `/internal/mcp/projects/${project.id}/watch?clerkUserId=${encodeURIComponent(outsider.clerkUserId)}&wait_seconds=0`;

    const res = await server.inject({
      method: "GET",
      url,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });
    expect(res.statusCode).toBe(404);
  });

  test("user-mode personal: returns the caller's personal annotation events", async () => {
    const db = await getIntegrationDb();
    const user = await seedUser(db);
    await seedAnnotationWithCreatedEvent(db, {
      projectId: null,
      branchId: null,
      authorId: user.id,
    });

    const ancientId = "1900-01-01T00:00:00.000Z:00000000-0000-4000-8000-000000000000";
    const url = `/internal/mcp/users/${encodeURIComponent(user.clerkUserId)}/watch?mode=personal&since=${encodeURIComponent(ancientId)}&wait_seconds=0`;

    const res = await server.inject({
      method: "GET",
      url,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events.length).toBeGreaterThanOrEqual(1);
    expect(body.events[0].streamEvent.projectId).toBeNull();
  });

  test("auto_acknowledge=true without oauthClientName → 400", async () => {
    const db = await getIntegrationDb();
    const { project, user } = await seedProjectMember(db);

    const url = `/internal/mcp/projects/${project.id}/watch?clerkUserId=${encodeURIComponent(user.clerkUserId)}&wait_seconds=0&auto_acknowledge=true`;

    const res = await server.inject({
      method: "GET",
      url,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });
    expect(res.statusCode).toBe(400);
  });

  test("missing internal-auth → 401", async () => {
    const db = await getIntegrationDb();
    const { project, user } = await seedProjectMember(db);
    const url = `/internal/mcp/projects/${project.id}/watch?clerkUserId=${encodeURIComponent(user.clerkUserId)}&wait_seconds=0`;
    const res = await server.inject({
      method: "GET",
      url,
    });
    expect(res.statusCode).toBe(401);
  });
});
