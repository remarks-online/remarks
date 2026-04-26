import { RemarksError } from "@remarks/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { hashApiToken } from "../lib/hash.js";
import type { AuthContext } from "../types/auth.js";

const mocks = vi.hoisted(() => ({
  resolveToken: vi.fn(),
  redisGet: vi.fn(),
  redisSet: vi.fn(),
}));

vi.mock("../lib/api-client.js", () => ({
  resolveToken: mocks.resolveToken,
}));

vi.mock("../lib/redis.js", () => ({
  redis: { get: mocks.redisGet, set: mocks.redisSet },
}));

const { default: mcpAuthPlugin } = await import("./mcp-auth.js");

// These mirror the placeholder values set in apps/mcp/test/setup.ts. Hash
// determinism asserts that the plugin uses the same salt the tests do.
const TEST_SALT = "x".repeat(32);
const TEST_PLAINTEXT = "rmk_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const EXPECTED_HASH = hashApiToken(TEST_PLAINTEXT, TEST_SALT);
const EXPECTED_CACHE_KEY = `cache:mcp:auth:${EXPECTED_HASH}`;

const SAMPLE_AUTH: AuthContext = {
  tokenId: "00000000-0000-0000-0000-000000000001",
  projectId: "00000000-0000-0000-0000-000000000002",
  scopes: ["tasks:read", "tasks:write", "project:read"],
};

function buildTestServer(): FastifyInstance {
  const server = Fastify({ logger: false });
  server.setErrorHandler((err, request, reply) => {
    if (err instanceof RemarksError) {
      return reply.status(err.statusCode).send({
        error: {
          code: err.code,
          message: err.exposed ? err.message : "Internal server error",
          requestId: request.id,
        },
      });
    }
    return reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "Internal server error", requestId: request.id },
    });
  });
  return server;
}

async function registerAuthedScope(server: FastifyInstance): Promise<void> {
  server.get("/_public", async () => ({ ok: true }));
  await server.register(async (authed) => {
    await authed.register(mcpAuthPlugin);
    authed.get("/_protected", async (req) => ({ auth: req.auth }));
  });
}

describe("mcp-auth plugin", () => {
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
    expect(mocks.redisGet).not.toHaveBeenCalled();
    expect(mocks.resolveToken).not.toHaveBeenCalled();
  });

  test("rejects non-Bearer Authorization headers", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/_protected",
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(res.statusCode).toBe(401);
    expect(mocks.redisGet).not.toHaveBeenCalled();
    expect(mocks.resolveToken).not.toHaveBeenCalled();
  });

  test("rejects empty Bearer tokens", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/_protected",
      headers: { authorization: "Bearer " },
    });
    expect(res.statusCode).toBe(401);
    expect(mocks.redisGet).not.toHaveBeenCalled();
    expect(mocks.resolveToken).not.toHaveBeenCalled();
  });

  test("returns cached AuthContext without calling the API", async () => {
    mocks.redisGet.mockResolvedValueOnce(SAMPLE_AUTH);
    const res = await server.inject({
      method: "GET",
      url: "/_protected",
      headers: { authorization: `Bearer ${TEST_PLAINTEXT}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().auth).toEqual(SAMPLE_AUTH);
    expect(mocks.redisGet).toHaveBeenCalledWith(EXPECTED_CACHE_KEY);
    expect(mocks.resolveToken).not.toHaveBeenCalled();
    expect(mocks.redisSet).not.toHaveBeenCalled();
  });

  test("falls through to resolveToken on cache miss and caches the result", async () => {
    mocks.redisGet.mockResolvedValueOnce(null);
    mocks.resolveToken.mockResolvedValueOnce(SAMPLE_AUTH);
    const res = await server.inject({
      method: "GET",
      url: "/_protected",
      headers: { authorization: `Bearer ${TEST_PLAINTEXT}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().auth).toEqual(SAMPLE_AUTH);
    expect(mocks.resolveToken).toHaveBeenCalledWith(EXPECTED_HASH);
    expect(mocks.redisSet).toHaveBeenCalledWith(EXPECTED_CACHE_KEY, SAMPLE_AUTH, { ex: 300 });
  });

  test("rejects when resolveToken returns null (unknown / expired / revoked)", async () => {
    mocks.redisGet.mockResolvedValueOnce(null);
    mocks.resolveToken.mockResolvedValueOnce(null);
    const res = await server.inject({
      method: "GET",
      url: "/_protected",
      headers: { authorization: `Bearer ${TEST_PLAINTEXT}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
    expect(res.json().error.message).toContain("Invalid or revoked");
    expect(mocks.redisSet).not.toHaveBeenCalled();
  });

  test("public sibling route outside the authed scope is not challenged", async () => {
    const res = await server.inject({ method: "GET", url: "/_public" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(mocks.redisGet).not.toHaveBeenCalled();
    expect(mocks.resolveToken).not.toHaveBeenCalled();
  });
});
