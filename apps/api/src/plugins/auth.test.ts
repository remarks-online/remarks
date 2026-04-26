import type { ClerkClient } from "@clerk/backend";
import { RemarksError, ValidationError } from "@remarks/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  getOrganizationMembershipList: vi.fn(),
  getUser: vi.fn(),
  findFirst: vi.fn(),
  provisionUserFromClerk: vi.fn(),
  provisionOrgsFromMemberships: vi.fn(),
  provisionProjectMembersFromOrgMemberships: vi.fn(),
}));

vi.mock("@clerk/backend", () => ({
  verifyToken: mocks.verifyToken,
  createClerkClient: () => ({
    users: {
      getOrganizationMembershipList: mocks.getOrganizationMembershipList,
      getUser: mocks.getUser,
    },
  }),
}));

vi.mock("../services/clerk-sync.service.js", () => ({
  provisionUserFromClerk: mocks.provisionUserFromClerk,
  provisionOrgsFromMemberships: mocks.provisionOrgsFromMemberships,
  provisionProjectMembersFromOrgMemberships: mocks.provisionProjectMembersFromOrgMemberships,
}));

const { default: authPlugin } = await import("./auth.js");

function buildTestServer(): FastifyInstance {
  const server = Fastify({ logger: false });
  server.setErrorHandler((err, request, reply) => {
    if (err instanceof RemarksError) {
      const body: {
        error: { code: string; message: string; requestId: string; issues?: unknown };
      } = {
        error: {
          code: err.code,
          message: err.exposed ? err.message : "Internal server error",
          requestId: request.id,
        },
      };
      if (err instanceof ValidationError && err.issues !== undefined) {
        body.error.issues = err.issues;
      }
      return reply.status(err.statusCode).send(body);
    }
    return reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "Internal server error", requestId: request.id },
    });
  });
  const db = {
    query: { users: { findFirst: mocks.findFirst } },
  };
  server.decorate("db", db as never);
  return server;
}

const fakeClerk = {
  users: {
    getOrganizationMembershipList: mocks.getOrganizationMembershipList,
    getUser: mocks.getUser,
  },
} as unknown as ClerkClient;

async function registerAuthedScope(server: FastifyInstance): Promise<void> {
  server.decorate("clerk", fakeClerk);
  server.get("/_public", async () => ({ ok: true }));
  await server.register(async (authed) => {
    await authed.register(authPlugin);
    authed.get("/_protected", async (req) => ({ auth: req.auth }));
  });
}

const SAMPLE_USER = {
  id: "00000000-0000-0000-0000-000000000001",
  clerkUserId: "user_123",
  email: "alice@example.com",
  name: "Alice Dev",
  avatarUrl: "https://img.example.com/alice.png",
  deletedAt: null,
};

describe("auth plugin", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    for (const fn of Object.values(mocks)) fn.mockReset();
    server = buildTestServer();
    await registerAuthedScope(server);
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  test("rejects requests with no Authorization header", async () => {
    const res = await server.inject({ method: "GET", url: "/_protected" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
    expect(mocks.verifyToken).not.toHaveBeenCalled();
  });

  test("rejects non-Bearer Authorization headers", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/_protected",
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
    expect(mocks.verifyToken).not.toHaveBeenCalled();
  });

  test("rejects empty Bearer tokens", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/_protected",
      headers: { authorization: "Bearer " },
    });
    expect(res.statusCode).toBe(401);
    expect(mocks.verifyToken).not.toHaveBeenCalled();
  });

  test("rejects tokens that fail verification", async () => {
    mocks.verifyToken.mockRejectedValueOnce(new Error("bad sig"));
    const res = await server.inject({
      method: "GET",
      url: "/_protected",
      headers: { authorization: "Bearer bad.token.value" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  test("lazily provisions the user when no DB row exists, then proceeds", async () => {
    mocks.verifyToken.mockResolvedValueOnce({ sub: "user_123" });
    mocks.findFirst.mockResolvedValueOnce(undefined);
    mocks.provisionUserFromClerk.mockResolvedValueOnce(SAMPLE_USER);
    mocks.getOrganizationMembershipList.mockResolvedValueOnce({ data: [] });
    const res = await server.inject({
      method: "GET",
      url: "/_protected",
      headers: { authorization: "Bearer valid.token" },
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.provisionUserFromClerk).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "user_123"
    );
    expect(res.json().auth.user.clerkUserId).toBe(SAMPLE_USER.clerkUserId);
  });

  test("rejects when lazy provisioning throws (Clerk getUser failed)", async () => {
    mocks.verifyToken.mockResolvedValueOnce({ sub: "user_123" });
    mocks.findFirst.mockResolvedValueOnce(undefined);
    mocks.provisionUserFromClerk.mockRejectedValueOnce(new Error("clerk 404"));
    const res = await server.inject({
      method: "GET",
      url: "/_protected",
      headers: { authorization: "Bearer valid.token" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toContain("Failed to load Clerk user");
    expect(mocks.getOrganizationMembershipList).not.toHaveBeenCalled();
  });

  test("rejects when lazy provisioning resolves but no row materializes", async () => {
    mocks.verifyToken.mockResolvedValueOnce({ sub: "user_123" });
    mocks.findFirst.mockResolvedValueOnce(undefined);
    mocks.provisionUserFromClerk.mockResolvedValueOnce(null);
    const res = await server.inject({
      method: "GET",
      url: "/_protected",
      headers: { authorization: "Bearer valid.token" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toContain("provisioning failed");
    expect(mocks.getOrganizationMembershipList).not.toHaveBeenCalled();
  });

  test("rejects when the clerk org membership fetch fails", async () => {
    mocks.verifyToken.mockResolvedValueOnce({ sub: "user_123" });
    mocks.findFirst.mockResolvedValueOnce(SAMPLE_USER);
    mocks.getOrganizationMembershipList.mockRejectedValueOnce(new Error("clerk 500"));
    const res = await server.inject({
      method: "GET",
      url: "/_protected",
      headers: { authorization: "Bearer valid.token" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  test("attaches user + empty orgMemberships for users with no orgs", async () => {
    mocks.verifyToken.mockResolvedValueOnce({ sub: "user_123" });
    mocks.findFirst.mockResolvedValueOnce(SAMPLE_USER);
    mocks.getOrganizationMembershipList.mockResolvedValueOnce({ data: [] });
    const res = await server.inject({
      method: "GET",
      url: "/_protected",
      headers: { authorization: "Bearer valid.token" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().auth).toEqual({
      user: {
        id: SAMPLE_USER.id,
        clerkUserId: SAMPLE_USER.clerkUserId,
        email: SAMPLE_USER.email,
        name: SAMPLE_USER.name,
        avatarUrl: SAMPLE_USER.avatarUrl,
      },
      orgMemberships: [],
    });
  });

  test("attaches user + multiple orgMemberships mapped to { clerkOrgId, role }", async () => {
    mocks.verifyToken.mockResolvedValueOnce({ sub: "user_123" });
    mocks.findFirst.mockResolvedValueOnce(SAMPLE_USER);
    mocks.getOrganizationMembershipList.mockResolvedValueOnce({
      data: [
        { role: "org:admin", organization: { id: "org_aaa", name: "AAA", slug: "aaa" } },
        { role: "org:member", organization: { id: "org_bbb", name: "BBB", slug: "bbb" } },
      ],
    });
    const res = await server.inject({
      method: "GET",
      url: "/_protected",
      headers: { authorization: "Bearer valid.token" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().auth.orgMemberships).toEqual([
      { clerkOrgId: "org_aaa", role: "org:admin" },
      { clerkOrgId: "org_bbb", role: "org:member" },
    ]);
  });

  test("public sibling route outside the authed scope is not challenged", async () => {
    const res = await server.inject({ method: "GET", url: "/_public" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mocks.verifyToken).not.toHaveBeenCalled();
  });
});
