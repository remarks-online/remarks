import { schema } from "@remarks/db";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  closeIntegrationDb,
  getIntegrationDb,
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

function mockAuth(args: { clerkUserId: string }): void {
  mocks.verifyToken.mockResolvedValueOnce({ sub: args.clerkUserId });
  mocks.getOrganizationMembershipList.mockResolvedValueOnce({ data: [] });
}

describe("Personal annotation endpoints (integration)", () => {
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

  function basePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      targetType: "element",
      url: "https://staging.acme.com/dashboard",
      targetSelector: "body > main > h1",
      viewport: { width: 1920, height: 1080, dpr: 2 },
      commentText: "Hero copy is too small on desktop",
      ...overrides,
    };
  }

  test("POST /annotations (no project) → 201, row has null projectId/branchId", async () => {
    const db = await getIntegrationDb();
    const user = await seedUser(db);

    mockAuth({ clerkUserId: user.clerkUserId });
    const res = await server.inject({
      method: "POST",
      url: "/annotations",
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: basePayload(),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.projectId).toBeNull();
    expect(body.branchId).toBeNull();
    expect(body.branchName).toBeNull();
    expect(body.author.id).toBe(user.id);

    const rows = await db.query.annotations.findMany({
      where: and(eq(schema.annotations.authorId, user.id), isNull(schema.annotations.projectId)),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.projectId).toBeNull();
    expect(rows[0]?.branchId).toBeNull();
  });

  test("POST /annotations rejects when projectId is provided", async () => {
    const db = await getIntegrationDb();
    const user = await seedUser(db);

    mockAuth({ clerkUserId: user.clerkUserId });
    const res = await server.inject({
      method: "POST",
      url: "/annotations",
      headers: { authorization: BEARER, "content-type": "application/json" },
      payload: basePayload({
        projectId: "11111111-1111-1111-1111-111111111111",
        branch: "main",
      }),
    });

    expect(res.statusCode).toBe(400);
  });

  test("GET /annotations?url= returns own personal rows but not other users'", async () => {
    const db = await getIntegrationDb();
    const me = await seedUser(db);
    const other = await seedUser(db);
    const url = "https://staging.acme.com/dashboard";

    await db.insert(schema.annotations).values([
      {
        authorId: me.id,
        projectId: null,
        branchId: null,
        targetType: "element",
        url,
        targetSelector: "h1",
        viewport: { width: 1920, height: 1080, dpr: 2 },
        commentText: "mine",
      },
      {
        authorId: other.id,
        projectId: null,
        branchId: null,
        targetType: "element",
        url,
        targetSelector: "h1",
        viewport: { width: 1920, height: 1080, dpr: 2 },
        commentText: "theirs",
      },
    ]);

    mockAuth({ clerkUserId: me.clerkUserId });
    const res = await server.inject({
      method: "GET",
      url: `/annotations?url=${encodeURIComponent(url)}`,
      headers: { authorization: BEARER },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].commentText).toBe("mine");
  });
});
