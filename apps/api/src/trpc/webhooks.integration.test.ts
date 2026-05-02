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

interface ProjectFixture {
  orgClerkId: string;
  userClerkId: string;
  userId: string;
  projectId: string;
}

async function seedProject(args: { role: "admin" | "editor" | "viewer" }): Promise<ProjectFixture> {
  const db = await getIntegrationDb();
  const org = await seedOrg(db);
  const user = await seedUser(db);
  const [project] = await db
    .insert(schema.projects)
    .values({
      orgId: org.id,
      creatorUserId: user.id,
      name: "Test Project",
      slug: `proj-${Math.random().toString(36).slice(2, 10)}`,
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

async function call(
  server: FastifyInstance,
  procedure: string,
  payload: Record<string, unknown>,
  authorized = true
) {
  return server.inject({
    method: "POST",
    url: `/trpc/${procedure}`,
    headers: {
      ...(authorized ? { authorization: BEARER } : {}),
      "content-type": "application/json",
    },
    payload,
  });
}

async function query(server: FastifyInstance, procedure: string, input: Record<string, unknown>) {
  const encoded = encodeURIComponent(JSON.stringify(input));
  return server.inject({
    method: "GET",
    url: `/trpc/${procedure}?input=${encoded}`,
    headers: { authorization: BEARER },
  });
}

describe("tRPC webhooks (integration)", () => {
  let server: FastifyInstance;
  let inngestSendSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    await getIntegrationDb();
    server = await buildServer();
    await server.ready();
    // Capture inngest.send calls without invoking the real service. Spy lives
    // for the whole describe block; reset between tests.
    inngestSendSpy = vi
      .spyOn(server.inngest, "send")
      // biome-ignore lint/suspicious/noExplicitAny: bypass strict union of inngest event shapes
      .mockImplementation(async (..._args: any[]) => ({ ids: [] }) as any);
  });

  afterAll(async () => {
    inngestSendSpy.mockRestore();
    await server.close();
    await closeIntegrationDb();
  });

  beforeEach(async () => {
    for (const fn of Object.values(mocks)) fn.mockReset();
    inngestSendSpy.mockClear();
    await truncateAll();
  });

  test("create returns secret once; list never exposes it", async () => {
    const fx = await seedProject({ role: "admin" });
    mockAuth({
      clerkUserId: fx.userClerkId,
      memberships: [{ clerkOrgId: fx.orgClerkId, role: "org:member" }],
    });

    const createRes = await call(server, "webhooks.create", {
      projectId: fx.projectId,
      input: {
        url: "https://example.com/hook",
        events: ["annotation.created", "annotation.resolved"],
      },
    });
    expect(createRes.statusCode).toBe(200);
    const created = createRes.json().result.data as {
      id: string;
      secret: string;
      events: string[];
      active: boolean;
    };
    expect(created.secret).toMatch(/^[a-f0-9]{64}$/);
    expect(created.events.sort()).toEqual(["annotation.created", "annotation.resolved"]);
    expect(created.active).toBe(true);

    mockAuth({
      clerkUserId: fx.userClerkId,
      memberships: [{ clerkOrgId: fx.orgClerkId, role: "org:member" }],
    });
    const listRes = await query(server, "webhooks.list", { projectId: fx.projectId });
    expect(listRes.statusCode).toBe(200);
    const items = listRes.json().result.data as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty("secret");
    expect(items[0]?.id).toBe(created.id);
  });

  test("non-admin gets FORBIDDEN on create / list", async () => {
    const fx = await seedProject({ role: "editor" });
    mockAuth({
      clerkUserId: fx.userClerkId,
      memberships: [{ clerkOrgId: fx.orgClerkId, role: "org:member" }],
    });
    const res = await call(server, "webhooks.create", {
      projectId: fx.projectId,
      input: { url: "https://example.com/hook", events: ["annotation.created"] },
    });
    expect(res.statusCode).toBe(403);
  });

  test("rejects http:// URLs at the boundary", async () => {
    const fx = await seedProject({ role: "admin" });
    mockAuth({
      clerkUserId: fx.userClerkId,
      memberships: [{ clerkOrgId: fx.orgClerkId, role: "org:member" }],
    });
    const res = await call(server, "webhooks.create", {
      projectId: fx.projectId,
      input: { url: "http://insecure.example.com", events: ["annotation.created"] },
    });
    expect(res.statusCode).toBe(400);
  });

  test("rotateSecret returns a new secret distinct from the old one", async () => {
    const fx = await seedProject({ role: "admin" });
    const db = await getIntegrationDb();
    const [webhook] = await db
      .insert(schema.projectWebhooks)
      .values({
        projectId: fx.projectId,
        url: "https://example.com/hook",
        secret: "deadbeef".repeat(8),
        events: ["annotation.created"],
      })
      .returning();
    if (!webhook) throw new Error("seed webhook failed");

    mockAuth({
      clerkUserId: fx.userClerkId,
      memberships: [{ clerkOrgId: fx.orgClerkId, role: "org:member" }],
    });
    const res = await call(server, "webhooks.rotateSecret", { webhookId: webhook.id });
    expect(res.statusCode).toBe(200);
    const rotated = res.json().result.data as { secret: string };
    expect(rotated.secret).not.toBe(webhook.secret);

    const after = await db.query.projectWebhooks.findFirst({
      where: eq(schema.projectWebhooks.id, webhook.id),
    });
    expect(after?.secret).toBe(rotated.secret);
  });

  test("creating an annotation fans out one inngest event per matching subscriber", async () => {
    const fx = await seedProject({ role: "admin" });
    const db = await getIntegrationDb();
    // Two webhooks: one subscribed, one not.
    await db.insert(schema.projectWebhooks).values([
      {
        projectId: fx.projectId,
        url: "https://example.com/a",
        secret: "x".repeat(64),
        events: ["annotation.created"],
      },
      {
        projectId: fx.projectId,
        url: "https://example.com/b",
        secret: "y".repeat(64),
        events: ["annotation.resolved"],
      },
    ]);

    mockAuth({
      clerkUserId: fx.userClerkId,
      memberships: [{ clerkOrgId: fx.orgClerkId, role: "org:member" }],
    });
    mocks.getUser.mockResolvedValueOnce({
      id: fx.userClerkId,
      emailAddresses: [{ emailAddress: "test@example.com", id: "ema_1" }],
      primaryEmailAddressId: "ema_1",
      firstName: "Test",
      lastName: "User",
      imageUrl: null,
    });

    // Use the REST endpoint to create the annotation since tRPC doesn't
    // expose `annotations.create` on the dashboard side. POST /projects/:id/annotations
    // is the canonical chokepoint and exercises the same service path.
    const res = await server.inject({
      method: "POST",
      url: `/projects/${fx.projectId}/annotations`,
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: {
        targetType: "element",
        url: "https://example.com/page",
        targetSelector: "body > div",
        viewport: { width: 1024, height: 768, dpr: 1 },
        commentText: "test annotation",
        branch: "main",
      },
    });
    expect(res.statusCode).toBe(201);

    // Fan-out is post-commit fire-and-forget (`void`). Poll for up to 1 s so
    // the DB findMany inside fanOutAnnotationEvent has time to complete and
    // call inngest.send.
    const findCalls = () =>
      inngestSendSpy.mock.calls.filter((args) => {
        const events = Array.isArray(args[0]) ? args[0] : [args[0]];
        return events.some((e: { name?: string }) => e?.name === "remarks/webhook.deliver");
      });
    for (let i = 0; i < 50; i++) {
      if (findCalls().length > 0) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const calls = findCalls();
    expect(calls).toHaveLength(1);
    const events = calls[0]?.[0] as Array<{
      name: string;
      data: { webhookId: string; eventType: string; projectId: string };
    }>;
    expect(events).toHaveLength(1);
    expect(events[0]?.data.eventType).toBe("annotation.created");
    expect(events[0]?.data.projectId).toBe(fx.projectId);
  });
});
