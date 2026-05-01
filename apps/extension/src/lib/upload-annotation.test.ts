import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ZodError } from "zod";
import type { Capture, ElementCapture, RectCapture } from "./picker-store";
import { UploadAnnotationError, isRetryable, uploadAnnotation } from "./upload-annotation";

// 1×1 transparent PNG — 67 bytes decoded, ~92-char base64 payload. The size
// delta is load-bearing for the sizeBytes-accuracy test.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;
const PNG_BYTE_LENGTH = atob(PNG_BASE64).length;

const API_URL = "https://api.remarks.test";
const TOKEN = "test-bearer-token";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ASSET_ID = "22222222-2222-4222-8222-222222222222";
const ANNOTATION_ID = "33333333-3333-4333-8333-333333333333";
const BRANCH_ID = "44444444-4444-4444-8444-444444444444";
const AUTHOR_ID = "55555555-5555-4555-8555-555555555555";

function makeElementCapture(overrides: Partial<ElementCapture> = {}): ElementCapture {
  return {
    kind: "element",
    url: "https://app.example.com/checkout",
    viewport: { width: 1920, height: 1080, dpr: 2 },
    scroll: { x: 0, y: 0 },
    capturedAt: 1_700_000_000_000,
    screenshot: { dataUrl: PNG_DATA_URL, width: 10, height: 10 },
    selector: "main > button.submit",
    strategy: "class",
    domContext: {
      tagName: "BUTTON",
      classes: ["submit"],
      textContent: "Place order",
    },
    targetCoords: { x: 100, y: 200, width: 80, height: 40 },
    ...overrides,
  };
}

function makeRectCapture(overrides: Partial<RectCapture> = {}): RectCapture {
  return {
    kind: "rect",
    url: "https://app.example.com/checkout",
    viewport: { width: 1280, height: 720, dpr: 1 },
    scroll: { x: 0, y: 0 },
    capturedAt: 1_700_000_000_000,
    screenshot: { dataUrl: PNG_DATA_URL, width: 10, height: 10 },
    rect: { x: 50, y: 60, width: 200, height: 150 },
    ...overrides,
  };
}

function validAnnotationResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ANNOTATION_ID,
    projectId: PROJECT_ID,
    projectSlug: "acme",
    branchId: BRANCH_ID,
    branchName: "main",
    status: "to_do",
    targetType: "element",
    intent: null,
    severity: null,
    url: "https://app.example.com/checkout",
    targetSelector: "main > button.submit",
    targetCoords: null,
    viewport: { width: 1920, height: 1080, dpr: 2 },
    commentText: "This button should use our brand green",
    author: {
      id: AUTHOR_ID,
      name: "Alice Dev",
      email: "alice@example.com",
      avatarUrl: null,
    },
    assets: [
      {
        id: ASSET_ID,
        kind: "screenshot",
        url: "https://r2.example.test/presigned-get",
        contentType: "image/png",
      },
    ],
    createdAt: "2026-04-24T12:00:00.000Z",
    updatedAt: "2026-04-24T12:00:00.000Z",
    ...overrides,
  };
}

function validPresignResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    assetId: ASSET_ID,
    uploadUrl: "https://r2.example.test/presigned-put",
    expiresAt: "2026-04-24T12:05:00.000Z",
    ...overrides,
  };
}

interface JsonResponseInit {
  status?: number;
  body?: unknown;
}

function jsonResponse({ status = 200, body }: JsonResponseInit = {}): Response {
  return new Response(body !== undefined ? JSON.stringify(body) : null, {
    status,
    headers: { "content-type": "application/json" },
  });
}

function emptyResponse(status = 200, text = ""): Response {
  return new Response(text, { status });
}

type FetchCall = { url: string; init: RequestInit };

function installFetchSequence(responses: Response[]): {
  calls: FetchCall[];
  fetchMock: ReturnType<typeof vi.fn>;
} {
  const calls: FetchCall[] = [];
  let idx = 0;
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init: init ?? {} });
    const next = responses[idx++];
    if (!next) throw new Error(`No mocked response for fetch call #${idx} to ${url}`);
    return next;
  });
  // Vitest runs in jsdom; fetch lives on globalThis.
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function parseJsonBody(init: RequestInit): Record<string, unknown> {
  if (typeof init.body !== "string") {
    throw new Error("Expected request body to be a string");
  }
  return JSON.parse(init.body) as Record<string, unknown>;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadAnnotation", () => {
  test("happy path with element capture posts presign, PUT, then create", async () => {
    const { calls } = installFetchSequence([
      jsonResponse({ status: 201, body: validPresignResponse() }),
      emptyResponse(200),
      jsonResponse({ status: 201, body: validAnnotationResponse() }),
    ]);

    const capture = makeElementCapture();
    const result = await uploadAnnotation({
      token: TOKEN,
      apiUrl: API_URL,
      projectId: PROJECT_ID,
      branch: "main",
      capture,
      commentText: "Looks off",
    });

    expect(result.id).toBe(ANNOTATION_ID);
    expect(calls).toHaveLength(3);

    // Presign
    expect(calls[0]?.url).toBe(`${API_URL}/uploads/presign`);
    expect(calls[0]?.init.method).toBe("POST");
    const presignBody = parseJsonBody(calls[0]?.init ?? {});
    expect(presignBody).toMatchObject({
      projectId: PROJECT_ID,
      kind: "screenshot",
      contentType: "image/png",
      sizeBytes: PNG_BYTE_LENGTH,
    });
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${TOKEN}`
    );

    // PUT
    expect(calls[1]?.url).toBe("https://r2.example.test/presigned-put");
    expect(calls[1]?.init.method).toBe("PUT");
    expect(calls[1]?.init.body).toBeInstanceOf(Blob);

    // Create
    expect(calls[2]?.url).toBe(`${API_URL}/projects/${PROJECT_ID}/annotations`);
    const createBody = parseJsonBody(calls[2]?.init ?? {});
    expect(createBody).toMatchObject({
      projectId: PROJECT_ID,
      branch: "main",
      targetType: "element",
      url: "https://app.example.com/checkout",
      targetSelector: "main > button.submit",
      commentText: "Looks off",
      screenshotAssetId: ASSET_ID,
      viewport: { width: 1920, height: 1080, dpr: 2 },
    });
    expect(createBody.domContext).toBeDefined();
    // Element captures send the bounding rect at capture time so the on-page
    // pin marker can render without re-resolving the selector.
    expect(createBody.targetCoords).toEqual({ x: 100, y: 200, width: 80, height: 40 });
  });

  test("happy path with rect capture maps kind 'rect' → targetType 'rectangle'", async () => {
    const { calls } = installFetchSequence([
      jsonResponse({ status: 201, body: validPresignResponse() }),
      emptyResponse(200),
      jsonResponse({
        status: 201,
        body: validAnnotationResponse({
          targetType: "rectangle",
          targetSelector: null,
          targetCoords: { x: 50, y: 60, width: 200, height: 150 },
        }),
      }),
    ]);

    await uploadAnnotation({
      token: TOKEN,
      apiUrl: API_URL,
      projectId: PROJECT_ID,
      branch: "main",
      capture: makeRectCapture(),
      commentText: "this area is wrong",
    });

    const createBody = parseJsonBody(calls[2]?.init ?? {});
    expect(createBody.targetType).toBe("rectangle");
    expect(createBody.targetCoords).toEqual({ x: 50, y: 60, width: 200, height: 150 });
    expect(createBody.targetSelector).toBeUndefined();
    expect(createBody.domContext).toBeUndefined();
  });

  test("no screenshot on capture skips presign + PUT and creates with no assetId", async () => {
    const { calls } = installFetchSequence([
      jsonResponse({
        status: 201,
        body: validAnnotationResponse({
          assets: [],
        }),
      }),
    ]);

    const { screenshot: _screenshot, ...withoutScreenshot } = makeElementCapture();
    const captureNoScreenshot: Capture = withoutScreenshot;
    await uploadAnnotation({
      token: TOKEN,
      apiUrl: API_URL,
      projectId: PROJECT_ID,
      branch: "main",
      capture: captureNoScreenshot,
      commentText: "no pic",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${API_URL}/projects/${PROJECT_ID}/annotations`);
    const body = parseJsonBody(calls[0]?.init ?? {});
    expect(body.screenshotAssetId).toBeUndefined();
  });

  test("presign 4xx throws UploadAnnotationError with step 'presign' and skips PUT + create", async () => {
    const { calls } = installFetchSequence([
      jsonResponse({ status: 403, body: { error: { code: "FORBIDDEN", message: "viewer" } } }),
    ]);

    await expect(
      uploadAnnotation({
        token: TOKEN,
        apiUrl: API_URL,
        projectId: PROJECT_ID,
        branch: "main",
        capture: makeElementCapture(),
        commentText: "hi",
      })
    ).rejects.toMatchObject({
      name: "UploadAnnotationError",
      step: "presign",
      status: 403,
    });
    expect(calls).toHaveLength(1);
  });

  test("PUT failure throws UploadAnnotationError with step 'put' and skips create", async () => {
    const { calls } = installFetchSequence([
      jsonResponse({ status: 201, body: validPresignResponse() }),
      emptyResponse(500, "boom"),
    ]);

    await expect(
      uploadAnnotation({
        token: TOKEN,
        apiUrl: API_URL,
        projectId: PROJECT_ID,
        branch: "main",
        capture: makeElementCapture(),
        commentText: "hi",
      })
    ).rejects.toMatchObject({
      name: "UploadAnnotationError",
      step: "put",
      status: 500,
    });
    expect(calls).toHaveLength(2);
  });

  test("create 4xx throws UploadAnnotationError with step 'create'", async () => {
    const { calls } = installFetchSequence([
      jsonResponse({ status: 201, body: validPresignResponse() }),
      emptyResponse(200),
      jsonResponse({ status: 422, body: { error: { code: "VALIDATION_ERROR" } } }),
    ]);

    await expect(
      uploadAnnotation({
        token: TOKEN,
        apiUrl: API_URL,
        projectId: PROJECT_ID,
        branch: "main",
        capture: makeElementCapture(),
        commentText: "hi",
      })
    ).rejects.toMatchObject({
      name: "UploadAnnotationError",
      step: "create",
      status: 422,
    });
    expect(calls).toHaveLength(3);
  });

  test("malformed create response is wrapped as UploadAnnotationError with ZodError cause", async () => {
    installFetchSequence([
      jsonResponse({ status: 201, body: validPresignResponse() }),
      emptyResponse(200),
      // Missing required fields → fails annotationResponseSchema.
      jsonResponse({ status: 201, body: { id: "not-a-uuid" } }),
    ]);

    const caught = await uploadAnnotation({
      token: TOKEN,
      apiUrl: API_URL,
      projectId: PROJECT_ID,
      branch: "main",
      capture: makeElementCapture(),
      commentText: "hi",
    }).catch((e: unknown) => e);

    expect(caught).toBeInstanceOf(UploadAnnotationError);
    const err = caught as UploadAnnotationError;
    expect(err.step).toBe("create");
    expect(err.cause).toBeInstanceOf(ZodError);
  });

  test("sizeBytes matches decoded blob length, not base64 string length", async () => {
    const { calls } = installFetchSequence([
      jsonResponse({ status: 201, body: validPresignResponse() }),
      emptyResponse(200),
      jsonResponse({ status: 201, body: validAnnotationResponse() }),
    ]);

    await uploadAnnotation({
      token: TOKEN,
      apiUrl: API_URL,
      projectId: PROJECT_ID,
      branch: "main",
      capture: makeElementCapture(),
      commentText: "hi",
    });

    const presignBody = parseJsonBody(calls[0]?.init ?? {});
    expect(presignBody.sizeBytes).toBe(PNG_BYTE_LENGTH);
    expect(presignBody.sizeBytes).not.toBe(PNG_BASE64.length);
  });
});

describe("isRetryable", () => {
  test("missing status (network failure) is retryable", () => {
    expect(isRetryable(new UploadAnnotationError("presign", "offline"))).toBe(true);
  });

  test("401, 408, 429 are retryable", () => {
    expect(isRetryable(new UploadAnnotationError("create", "unauth", 401))).toBe(true);
    expect(isRetryable(new UploadAnnotationError("create", "timeout", 408))).toBe(true);
    expect(isRetryable(new UploadAnnotationError("create", "rate limit", 429))).toBe(true);
  });

  test("5xx responses are retryable", () => {
    expect(isRetryable(new UploadAnnotationError("put", "bad gateway", 502))).toBe(true);
    expect(isRetryable(new UploadAnnotationError("create", "down", 503))).toBe(true);
  });

  test("400, 403, 404, 409, 413 are not retryable", () => {
    expect(isRetryable(new UploadAnnotationError("create", "validation", 400))).toBe(false);
    expect(isRetryable(new UploadAnnotationError("create", "forbidden", 403))).toBe(false);
    expect(isRetryable(new UploadAnnotationError("create", "not found", 404))).toBe(false);
    expect(isRetryable(new UploadAnnotationError("create", "conflict", 409))).toBe(false);
    expect(isRetryable(new UploadAnnotationError("presign", "too big", 413))).toBe(false);
  });

  test("unknown error types default to retryable", () => {
    expect(isRetryable(new Error("something broke"))).toBe(true);
    expect(isRetryable(undefined)).toBe(true);
  });
});
