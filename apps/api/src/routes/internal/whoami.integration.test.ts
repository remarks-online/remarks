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

// /internal/* never reaches Clerk, but buildServer still registers the Clerk
// plugin and the authenticated scope; mocking the SDK keeps `createClerkClient`
// from doing anything network-y at boot. Mirrors the pattern in
// apps/api/src/routes/internal/tokens.integration.test.ts.
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

async function seedToken(
  db: Db,
  overrides: Partial<typeof schema.projectApiTokens.$inferInsert> = {}
): Promise<{
  project: typeof schema.projects.$inferSelect;
  token: typeof schema.projectApiTokens.$inferSelect;
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
  if (!project) throw new Error("seedToken: project insert returned no rows");
  const [token] = await db
    .insert(schema.projectApiTokens)
    .values({
      projectId: project.id,
      name: "Claude Code on my laptop",
      tokenHash: `hash_${rand()}_${rand()}`,
      tokenPrefix: "rmk_live_xxx",
      tokenLast4: "abcd",
      scopes: ["tasks:read", "tasks:write", "project:read"],
      createdById: user.id,
      ...overrides,
    })
    .returning();
  if (!token) throw new Error("seedToken: token insert returned no rows");
  return { project, token };
}

describe("GET /internal/mcp/whoami/:tokenId (integration)", () => {
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

  test("valid tokenId → 200 with token + project payload", async () => {
    const db = await getIntegrationDb();
    const { project, token } = await seedToken(db);

    const res = await server.inject({
      method: "GET",
      url: `/internal/mcp/whoami/${token.id}`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      token: {
        id: token.id,
        name: "Claude Code on my laptop",
        scopes: ["tasks:read", "tasks:write", "project:read"],
      },
      project: { id: project.id, name: project.name, slug: project.slug },
    });
  });

  test("revoked token → 404 NOT_FOUND", async () => {
    const db = await getIntegrationDb();
    const { token } = await seedToken(db, { revokedAt: new Date() });

    const res = await server.inject({
      method: "GET",
      url: `/internal/mcp/whoami/${token.id}`,
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  test("unknown tokenId → 404 NOT_FOUND", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/internal/mcp/whoami/00000000-0000-0000-0000-000000000000",
      headers: { "x-internal-auth": INTERNAL_TOKEN },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  test("missing x-internal-auth → 401 UNAUTHORIZED", async () => {
    const db = await getIntegrationDb();
    const { token } = await seedToken(db);

    const res = await server.inject({
      method: "GET",
      url: `/internal/mcp/whoami/${token.id}`,
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});
