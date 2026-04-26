import { describe, expect, test } from "vitest";
import { createProjectRequestSchema, projectResponseSchema } from "./project.js";

describe("createProjectRequestSchema", () => {
  test("accepts valid slug", () => {
    const result = createProjectRequestSchema.safeParse({
      name: "Acme Dashboard",
      slug: "acme-dashboard",
    });
    expect(result.success).toBe(true);
  });

  test("defaults primaryBranch to 'main'", () => {
    const result = createProjectRequestSchema.safeParse({
      name: "Acme",
      slug: "acme",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.primaryBranch).toBe("main");
    }
  });

  test("rejects uppercase slug", () => {
    expect(createProjectRequestSchema.safeParse({ name: "Acme", slug: "Acme" }).success).toBe(
      false
    );
  });

  test("rejects slug with underscore", () => {
    expect(
      createProjectRequestSchema.safeParse({ name: "Acme", slug: "acme_dashboard" }).success
    ).toBe(false);
  });

  test("rejects empty name", () => {
    expect(createProjectRequestSchema.safeParse({ name: "", slug: "acme" }).success).toBe(false);
  });

  test("rejects name over 100 chars", () => {
    expect(
      createProjectRequestSchema.safeParse({
        name: "a".repeat(101),
        slug: "acme",
      }).success
    ).toBe(false);
  });

  test("accepts optional gitRepoUrl when valid", () => {
    expect(
      createProjectRequestSchema.safeParse({
        name: "Acme",
        slug: "acme",
        gitRepoUrl: "https://github.com/acme/repo",
      }).success
    ).toBe(true);
  });

  test("rejects malformed gitRepoUrl", () => {
    expect(
      createProjectRequestSchema.safeParse({
        name: "Acme",
        slug: "acme",
        gitRepoUrl: "not-a-url",
      }).success
    ).toBe(false);
  });
});

describe("projectResponseSchema", () => {
  test("accepts null gitRepoUrl and null myRole", () => {
    const result = projectResponseSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000001",
      orgId: "00000000-0000-4000-8000-000000000002",
      name: "Acme",
      slug: "acme",
      gitRepoUrl: null,
      primaryBranch: "main",
      myRole: null,
      createdAt: "2026-04-22T12:00:00.000Z",
      updatedAt: "2026-04-22T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  test("accepts each project role for myRole", () => {
    for (const role of ["admin", "editor", "viewer"] as const) {
      const result = projectResponseSchema.safeParse({
        id: "00000000-0000-4000-8000-000000000001",
        orgId: "00000000-0000-4000-8000-000000000002",
        name: "Acme",
        slug: "acme",
        gitRepoUrl: null,
        primaryBranch: "main",
        myRole: role,
        createdAt: "2026-04-22T12:00:00.000Z",
        updatedAt: "2026-04-22T12:00:00.000Z",
      });
      expect(result.success).toBe(true);
    }
  });
});
