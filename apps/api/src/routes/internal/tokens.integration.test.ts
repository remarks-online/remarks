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

// /internal/* never reaches Clerk, but buildServer still registers the Clerk
// plugin and the authenticated scope; mocking the SDK keeps `createClerkClient`
// from doing anything network-y at boot. Mirrors the pattern in
// apps/api/src/routes/projects/*.integration.test.ts.
vi.mock("@clerk/backend", () => ({
  verifyToken: vi.fn(),
  createClerkClient: () => ({
    users: { getOrganizationMembershipList: vi.fn(), getUser: vi.fn() },
    organizations: { getOrganizationMembershipList: vi.fn() },
  }),
}));

const { buildServer } = await import("../../server.js");

// Same value the integration setup defaults to (test/integration/setup.ts).
// The internal-auth plugin reads this at module load via env.ts, so the
// successful-auth tests must inject this exact string.
const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN as string;

const RESOLVE_PATH = "/internal/mcp/tokens/resolve";

type Db = Awaited<ReturnType<typeof getIntegrationDb>>;

function rand(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function seedProject(db: Db, orgId: string): Promise<typeof schema.projects.$inferSelect> {
  const [row] = await db
    .insert(schema.projects)
    .values({
      orgId,
      name: `Project ${rand()}`,
      slug: `proj-${rand()}`,
      primaryBranch: "main",
    })
    .returning();
  if (!row) throw new Error("seedProject: no row returned");
  return row;
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
  const project = await seedProject(db, org.id);
  const [token] = await db
    .insert(schema.projectApiTokens)
    .values({
      projectId: project.id,
      name: "test-token",
      tokenHash: `hash_${rand()}_${rand()}`,
      tokenPrefix: "rmk_live_xxx",
      tokenLast4: "abcd",
      scopes: ["tasks:read", "tasks:write", "project:read"],
      createdById: user.id,
      ...overrides,
    })
    .returning();
  if (!token) throw new Error("seedToken: no row returned");
  return { project, token };
}

describe("POST /internal/mcp/tokens/resolve (integration)", () => {
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

  test("valid token → 200, returns auth context and bumps last_used_at", async () => {
    const db = await getIntegrationDb();
    const { project, token } = await seedToken(db);

    const before = Date.now();
    const res = await server.inject({
      method: "POST",
      url: RESOLVE_PATH,
      headers: {
        "x-internal-auth": INTERNAL_TOKEN,
        "content-type": "application/json",
      },
      payload: { tokenHash: token.tokenHash },
    });
    const after = Date.now();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      tokenId: token.id,
      projectId: project.id,
      scopes: ["tasks:read", "tasks:write", "project:read"],
    });

    const fresh = await db.query.projectApiTokens.findFirst({
      where: eq(schema.projectApiTokens.id, token.id),
    });
    expect(fresh?.lastUsedAt).not.toBeNull();
    const usedMs = fresh?.lastUsedAt?.getTime() ?? 0;
    // Within the request window (small slop for clock skew between Node and PG)
    expect(usedMs).toBeGreaterThanOrEqual(before - 5_000);
    expect(usedMs).toBeLessThanOrEqual(after + 5_000);
  });

  test("unknown tokenHash → 404 NOT_FOUND", async () => {
    const res = await server.inject({
      method: "POST",
      url: RESOLVE_PATH,
      headers: {
        "x-internal-auth": INTERNAL_TOKEN,
        "content-type": "application/json",
      },
      payload: { tokenHash: "no-such-hash" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  test("revoked token → 404, last_used_at not bumped", async () => {
    const db = await getIntegrationDb();
    const { token } = await seedToken(db, { revokedAt: new Date() });

    const res = await server.inject({
      method: "POST",
      url: RESOLVE_PATH,
      headers: {
        "x-internal-auth": INTERNAL_TOKEN,
        "content-type": "application/json",
      },
      payload: { tokenHash: token.tokenHash },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");

    const fresh = await db.query.projectApiTokens.findFirst({
      where: eq(schema.projectApiTokens.id, token.id),
    });
    expect(fresh?.lastUsedAt).toBeNull();
  });

  test("expired token → 404, last_used_at not bumped", async () => {
    const db = await getIntegrationDb();
    const past = new Date(Date.now() - 60_000);
    const { token } = await seedToken(db, { expiresAt: past });

    const res = await server.inject({
      method: "POST",
      url: RESOLVE_PATH,
      headers: {
        "x-internal-auth": INTERNAL_TOKEN,
        "content-type": "application/json",
      },
      payload: { tokenHash: token.tokenHash },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");

    const fresh = await db.query.projectApiTokens.findFirst({
      where: eq(schema.projectApiTokens.id, token.id),
    });
    expect(fresh?.lastUsedAt).toBeNull();
  });

  test("future expiresAt → 200 (boundary check)", async () => {
    const db = await getIntegrationDb();
    const future = new Date(Date.now() + 60 * 60_000);
    const { token } = await seedToken(db, { expiresAt: future });

    const res = await server.inject({
      method: "POST",
      url: RESOLVE_PATH,
      headers: {
        "x-internal-auth": INTERNAL_TOKEN,
        "content-type": "application/json",
      },
      payload: { tokenHash: token.tokenHash },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().tokenId).toBe(token.id);
  });

  test("missing x-internal-auth → 401 UNAUTHORIZED", async () => {
    const db = await getIntegrationDb();
    const { token } = await seedToken(db);

    const res = await server.inject({
      method: "POST",
      url: RESOLVE_PATH,
      headers: { "content-type": "application/json" },
      payload: { tokenHash: token.tokenHash },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  test("wrong x-internal-auth (different length) → 401", async () => {
    const db = await getIntegrationDb();
    const { token } = await seedToken(db);

    const res = await server.inject({
      method: "POST",
      url: RESOLVE_PATH,
      headers: {
        "x-internal-auth": "wrong",
        "content-type": "application/json",
      },
      payload: { tokenHash: token.tokenHash },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  test("wrong x-internal-auth (same length) → 401, exercises constant-time path", async () => {
    const db = await getIntegrationDb();
    const { token } = await seedToken(db);
    const wrongSameLength = "z".repeat(INTERNAL_TOKEN.length);
    expect(wrongSameLength.length).toBe(INTERNAL_TOKEN.length);
    expect(wrongSameLength).not.toBe(INTERNAL_TOKEN);

    const res = await server.inject({
      method: "POST",
      url: RESOLVE_PATH,
      headers: {
        "x-internal-auth": wrongSameLength,
        "content-type": "application/json",
      },
      payload: { tokenHash: token.tokenHash },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  test("body missing tokenHash → 400 VALIDATION_ERROR", async () => {
    const res = await server.inject({
      method: "POST",
      url: RESOLVE_PATH,
      headers: {
        "x-internal-auth": INTERNAL_TOKEN,
        "content-type": "application/json",
      },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(res.json().error.issues)).toBe(true);
  });

  test("public /health unaffected by internal-auth scope", async () => {
    const res = await server.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});
