import { ForbiddenError, NotFoundError } from "@remarks/shared";
import type { FastifyRequest } from "fastify";
import { describe, expect, test, vi } from "vitest";
import { requireOrgMember, requireProjectMember } from "./authorization.js";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

interface MockOverrides {
  userId?: string;
  orgMemberships?: Array<{ clerkOrgId: string; role: string }>;
  findFirst?: ReturnType<typeof vi.fn>;
}

function makeRequest(overrides: MockOverrides = {}): {
  request: FastifyRequest;
  findFirst: ReturnType<typeof vi.fn>;
} {
  const findFirst = overrides.findFirst ?? vi.fn();
  const request = {
    auth: {
      user: {
        id: overrides.userId ?? USER_ID,
        clerkUserId: "user_x",
        email: null,
        name: null,
        avatarUrl: null,
      },
      orgMemberships: overrides.orgMemberships ?? [],
    },
    server: {
      db: {
        query: {
          projectMembers: { findFirst },
        },
      },
    },
  } as unknown as FastifyRequest;
  return { request, findFirst };
}

describe("requireOrgMember", () => {
  test("returns the membership when user is a member (no role constraint)", () => {
    const { request } = makeRequest({
      orgMemberships: [{ clerkOrgId: "org_aaa", role: "org:member" }],
    });
    const result = requireOrgMember(request, "org_aaa");
    expect(result).toEqual({ clerkOrgId: "org_aaa", role: "org:member" });
  });

  test("returns the membership when user is org:admin and admin is required", () => {
    const { request } = makeRequest({
      orgMemberships: [{ clerkOrgId: "org_aaa", role: "org:admin" }],
    });
    const result = requireOrgMember(request, "org_aaa", { role: "admin" });
    expect(result).toEqual({ clerkOrgId: "org_aaa", role: "org:admin" });
  });

  test("throws ForbiddenError when org:member is asked for admin", () => {
    const { request } = makeRequest({
      orgMemberships: [{ clerkOrgId: "org_aaa", role: "org:member" }],
    });
    let caught: unknown;
    try {
      requireOrgMember(request, "org_aaa", { role: "admin" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ForbiddenError);
    expect((caught as ForbiddenError).code).toBe("FORBIDDEN");
    expect((caught as ForbiddenError).statusCode).toBe(403);
  });

  test("throws ForbiddenError when user is not in the org", () => {
    const { request } = makeRequest({
      orgMemberships: [{ clerkOrgId: "org_bbb", role: "org:admin" }],
    });
    expect(() => requireOrgMember(request, "org_aaa")).toThrow(ForbiddenError);
  });

  test("throws ForbiddenError when orgMemberships is empty", () => {
    const { request } = makeRequest({ orgMemberships: [] });
    expect(() => requireOrgMember(request, "org_aaa")).toThrow(ForbiddenError);
  });
});

describe("requireProjectMember", () => {
  test("returns role when membership exists and no minRole is given", async () => {
    const findFirst = vi.fn().mockResolvedValue({ role: "editor" });
    const { request } = makeRequest({ findFirst });
    const result = await requireProjectMember(request, PROJECT_ID);
    expect(result).toEqual({ role: "editor" });
  });

  test("returns role when admin role meets minRole: admin", async () => {
    const findFirst = vi.fn().mockResolvedValue({ role: "admin" });
    const { request } = makeRequest({ findFirst });
    const result = await requireProjectMember(request, PROJECT_ID, { minRole: "admin" });
    expect(result).toEqual({ role: "admin" });
  });

  test("throws ForbiddenError when viewer is asked for editor", async () => {
    const findFirst = vi.fn().mockResolvedValue({ role: "viewer" });
    const { request } = makeRequest({ findFirst });
    let caught: unknown;
    try {
      await requireProjectMember(request, PROJECT_ID, { minRole: "editor" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ForbiddenError);
    expect((caught as ForbiddenError).code).toBe("FORBIDDEN");
    expect((caught as ForbiddenError).statusCode).toBe(403);
  });

  test("throws ForbiddenError when editor is asked for admin", async () => {
    const findFirst = vi.fn().mockResolvedValue({ role: "editor" });
    const { request } = makeRequest({ findFirst });
    await expect(
      requireProjectMember(request, PROJECT_ID, { minRole: "admin" })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("throws NotFoundError when there is no membership row", async () => {
    const findFirst = vi.fn().mockResolvedValue(undefined);
    const { request } = makeRequest({ findFirst });
    let caught: unknown;
    try {
      await requireProjectMember(request, PROJECT_ID);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NotFoundError);
    expect((caught as NotFoundError).code).toBe("NOT_FOUND");
    expect((caught as NotFoundError).statusCode).toBe(404);
  });

  test("queries projectMembers with a where clause and columns: { role: true }", async () => {
    const findFirst = vi.fn().mockResolvedValue({ role: "viewer" });
    const { request } = makeRequest({ findFirst });
    await requireProjectMember(request, PROJECT_ID);
    expect(findFirst).toHaveBeenCalledTimes(1);
    const arg = findFirst.mock.calls[0]?.[0];
    expect(arg).toBeDefined();
    expect(arg).toHaveProperty("where");
    expect(arg.columns).toEqual({ role: true });
  });
});
