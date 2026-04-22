import { describe, expect, test } from "vitest";
import { presignedUploadRequestSchema, presignedUploadResponseSchema } from "./common.js";

const baseRequest = {
  projectId: "00000000-0000-4000-8000-000000000001",
  kind: "screenshot" as const,
  contentType: "image/png",
  sizeBytes: 1_000_000,
};

describe("presignedUploadRequestSchema", () => {
  test("accepts a valid request", () => {
    expect(presignedUploadRequestSchema.safeParse(baseRequest).success).toBe(true);
  });

  test("rejects malformed content type", () => {
    expect(
      presignedUploadRequestSchema.safeParse({ ...baseRequest, contentType: "image png" }).success
    ).toBe(false);
  });

  test("rejects zero size", () => {
    expect(presignedUploadRequestSchema.safeParse({ ...baseRequest, sizeBytes: 0 }).success).toBe(
      false
    );
  });

  test("rejects size over 50 MB", () => {
    expect(
      presignedUploadRequestSchema.safeParse({ ...baseRequest, sizeBytes: 50_000_001 }).success
    ).toBe(false);
  });

  test("rejects unknown kind", () => {
    expect(presignedUploadRequestSchema.safeParse({ ...baseRequest, kind: "audio" }).success).toBe(
      false
    );
  });
});

describe("presignedUploadResponseSchema", () => {
  test("accepts a valid response without optional fields", () => {
    expect(
      presignedUploadResponseSchema.safeParse({
        assetId: "00000000-0000-4000-8000-000000000002",
        uploadUrl: "https://r2.example.com/upload",
        expiresAt: "2026-04-22T13:00:00.000Z",
      }).success
    ).toBe(true);
  });

  test("rejects response missing uploadUrl", () => {
    expect(
      presignedUploadResponseSchema.safeParse({
        assetId: "00000000-0000-4000-8000-000000000002",
        expiresAt: "2026-04-22T13:00:00.000Z",
      }).success
    ).toBe(false);
  });
});
