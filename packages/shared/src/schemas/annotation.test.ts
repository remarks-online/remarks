import { describe, expect, test } from "vitest";
import {
  annotationResponseSchema,
  createAnnotationRequestSchema,
  updateAnnotationRequestSchema,
  viewportSchema,
} from "./annotation.js";

const validViewport = { width: 1440, height: 900, dpr: 2 };

const baseRequest = {
  projectId: "00000000-0000-4000-8000-000000000001",
  branch: "main",
  url: "https://example.com/page",
  viewport: validViewport,
  commentText: "Button is misaligned",
};

describe("createAnnotationRequestSchema", () => {
  test("accepts an element annotation with selector", () => {
    expect(
      createAnnotationRequestSchema.safeParse({
        ...baseRequest,
        targetType: "element",
        targetSelector: "main > button.primary",
      }).success
    ).toBe(true);
  });

  test("accepts a rectangle annotation with coords", () => {
    expect(
      createAnnotationRequestSchema.safeParse({
        ...baseRequest,
        targetType: "rectangle",
        targetCoords: { x: 10, y: 20, width: 100, height: 50 },
      }).success
    ).toBe(true);
  });

  test("accepts a route annotation with neither selector nor coords", () => {
    expect(
      createAnnotationRequestSchema.safeParse({
        ...baseRequest,
        targetType: "route",
      }).success
    ).toBe(true);
  });

  test("rejects element annotation without selector", () => {
    const result = createAnnotationRequestSchema.safeParse({
      ...baseRequest,
      targetType: "element",
    });
    expect(result.success).toBe(false);
  });

  test("rejects rectangle annotation without coords", () => {
    const result = createAnnotationRequestSchema.safeParse({
      ...baseRequest,
      targetType: "rectangle",
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty comment", () => {
    expect(
      createAnnotationRequestSchema.safeParse({
        ...baseRequest,
        targetType: "route",
        commentText: "",
      }).success
    ).toBe(false);
  });

  test("rejects comment over 5000 chars", () => {
    expect(
      createAnnotationRequestSchema.safeParse({
        ...baseRequest,
        targetType: "route",
        commentText: "x".repeat(5001),
      }).success
    ).toBe(false);
  });

  test("rejects selector over 2000 chars", () => {
    expect(
      createAnnotationRequestSchema.safeParse({
        ...baseRequest,
        targetType: "element",
        targetSelector: "a".repeat(2001),
      }).success
    ).toBe(false);
  });

  test("rejects invalid url", () => {
    expect(
      createAnnotationRequestSchema.safeParse({
        ...baseRequest,
        url: "not-a-url",
        targetType: "route",
      }).success
    ).toBe(false);
  });
});

describe("viewportSchema", () => {
  test("rejects zero width", () => {
    expect(viewportSchema.safeParse({ width: 0, height: 900, dpr: 1 }).success).toBe(false);
  });

  test("rejects negative dpr", () => {
    expect(viewportSchema.safeParse({ width: 1440, height: 900, dpr: -1 }).success).toBe(false);
  });
});

describe("annotationResponseSchema", () => {
  const validResponse = {
    id: "00000000-0000-4000-8000-000000000002",
    projectId: "00000000-0000-4000-8000-000000000001",
    projectSlug: "acme",
    branchId: "00000000-0000-4000-8000-000000000003",
    branchName: "main",
    status: "to_do" as const,
    targetType: "element" as const,
    intent: null,
    severity: null,
    url: "https://example.com/page",
    targetSelector: "button.primary",
    targetCoords: null,
    viewport: validViewport,
    domContext: null,
    commentText: "Needs fixing",
    author: {
      id: "00000000-0000-4000-8000-000000000004",
      name: "Dev",
      email: "dev@example.com",
      avatarUrl: null,
    },
    assets: [],
    createdAt: "2026-04-22T12:00:00.000Z",
    updatedAt: "2026-04-22T12:00:00.000Z",
  };

  test("accepts null targetCoords when targetSelector is set", () => {
    expect(annotationResponseSchema.safeParse(validResponse).success).toBe(true);
  });

  test("accepts null targetSelector when targetCoords is set", () => {
    expect(
      annotationResponseSchema.safeParse({
        ...validResponse,
        targetType: "rectangle",
        targetSelector: null,
        targetCoords: { x: 1, y: 2, width: 3, height: 4 },
      }).success
    ).toBe(true);
  });
});

describe("updateAnnotationRequestSchema", () => {
  test("accepts status-only update", () => {
    expect(updateAnnotationRequestSchema.safeParse({ status: "done" }).success).toBe(true);
  });

  test("accepts commentText-only update", () => {
    expect(updateAnnotationRequestSchema.safeParse({ commentText: "Fixed" }).success).toBe(true);
  });

  test("rejects empty update", () => {
    expect(updateAnnotationRequestSchema.safeParse({}).success).toBe(false);
  });
});
