import {
  type AnnotationResponse,
  type CreateAnnotationRequest,
  type PresignedUploadRequest,
  type PresignedUploadResponse,
  annotationResponseSchema,
  presignedUploadResponseSchema,
} from "@remarks/shared";
import type { Capture } from "./picker-store";

export type UploadStep = "presign" | "put" | "create";

export class UploadAnnotationError extends Error {
  readonly step: UploadStep;
  readonly status: number | undefined;

  constructor(step: UploadStep, message: string, status?: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "UploadAnnotationError";
    this.step = step;
    this.status = status;
  }
}

export interface UploadAnnotationInput {
  // Clerk Bearer token; caller guarantees non-empty.
  token: string;
  // `env.WXT_API_URL`, no trailing slash.
  apiUrl: string;
  projectId: string;
  // Task 1.27 hardcodes "main"; task 1.30 threads the free-text branch through.
  branch: string;
  // Caller guarantees non-null (button is disabled unless capture present).
  capture: Capture;
  commentText: string;
}

export async function uploadAnnotation(input: UploadAnnotationInput): Promise<AnnotationResponse> {
  let screenshotAssetId: string | undefined;

  if (input.capture.screenshot) {
    const blob = dataUrlToBlob(input.capture.screenshot.dataUrl, "image/png");
    const presigned = await presign({
      token: input.token,
      apiUrl: input.apiUrl,
      projectId: input.projectId,
      contentType: "image/png",
      sizeBytes: blob.size,
    });
    await putObject(presigned.uploadUrl, blob);
    screenshotAssetId = presigned.assetId;
  }

  const body = buildCreateBody(input, screenshotAssetId);
  return createAnnotation({
    token: input.token,
    apiUrl: input.apiUrl,
    projectId: input.projectId,
    body,
  });
}

function dataUrlToBlob(dataUrl: string, fallbackContentType: string): Blob {
  // Format: "data:<mime>;base64,<payload>" — split once on the comma that
  // follows the metadata prefix. Anything non-base64 would require encoding
  // work we don't want to carry here; screenshots are always base64 PNG.
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx < 0) {
    throw new UploadAnnotationError("presign", "Malformed screenshot data URL");
  }
  const meta = dataUrl.slice(5, commaIdx); // drop leading "data:"
  const payload = dataUrl.slice(commaIdx + 1);
  const isBase64 = meta.endsWith(";base64");
  if (!isBase64) {
    throw new UploadAnnotationError("presign", "Screenshot data URL is not base64-encoded");
  }
  const contentType = meta.replace(/;base64$/, "") || fallbackContentType;

  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: contentType });
}

interface PresignArgs {
  token: string;
  apiUrl: string;
  projectId: string;
  contentType: string;
  sizeBytes: number;
}

async function presign(args: PresignArgs): Promise<PresignedUploadResponse> {
  const body: PresignedUploadRequest = {
    projectId: args.projectId,
    kind: "screenshot",
    contentType: args.contentType,
    sizeBytes: args.sizeBytes,
  };
  let res: Response;
  try {
    res = await fetch(`${args.apiUrl}/uploads/presign`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${args.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new UploadAnnotationError(
      "presign",
      "Network error contacting /uploads/presign",
      undefined,
      {
        cause: err,
      }
    );
  }
  if (!res.ok) {
    const detail = await safeReadText(res);
    throw new UploadAnnotationError(
      "presign",
      detail ? `${res.status} ${res.statusText}: ${detail}` : `${res.status} ${res.statusText}`,
      res.status
    );
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new UploadAnnotationError("presign", "Presign response was not valid JSON", res.status, {
      cause: err,
    });
  }
  try {
    return presignedUploadResponseSchema.parse(json);
  } catch (err) {
    throw new UploadAnnotationError(
      "presign",
      "Presign response failed schema validation",
      res.status,
      {
        cause: err,
      }
    );
  }
}

async function putObject(uploadUrl: string, blob: Blob): Promise<void> {
  let res: Response;
  try {
    res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": blob.type || "image/png" },
      body: blob,
    });
  } catch (err) {
    throw new UploadAnnotationError("put", "Network error uploading screenshot to R2", undefined, {
      cause: err,
    });
  }
  if (!res.ok) {
    const detail = await safeReadText(res);
    throw new UploadAnnotationError(
      "put",
      detail ? `${res.status} ${res.statusText}: ${detail}` : `${res.status} ${res.statusText}`,
      res.status
    );
  }
}

function buildCreateBody(
  input: UploadAnnotationInput,
  screenshotAssetId: string | undefined
): CreateAnnotationRequest {
  const base = {
    projectId: input.projectId,
    branch: input.branch,
    url: input.capture.url,
    viewport: input.capture.viewport,
    commentText: input.commentText,
    ...(screenshotAssetId ? { screenshotAssetId } : {}),
  };
  if (input.capture.kind === "element") {
    return {
      ...base,
      targetType: "element",
      targetSelector: input.capture.selector,
      domContext: input.capture.domContext,
    };
  }
  return {
    ...base,
    targetType: "rectangle",
    targetCoords: input.capture.rect,
  };
}

interface CreateArgs {
  token: string;
  apiUrl: string;
  projectId: string;
  body: CreateAnnotationRequest;
}

async function createAnnotation(args: CreateArgs): Promise<AnnotationResponse> {
  let res: Response;
  try {
    res = await fetch(`${args.apiUrl}/projects/${args.projectId}/annotations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${args.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args.body),
    });
  } catch (err) {
    throw new UploadAnnotationError("create", "Network error creating annotation", undefined, {
      cause: err,
    });
  }
  if (!res.ok) {
    const detail = await safeReadText(res);
    throw new UploadAnnotationError(
      "create",
      detail ? `${res.status} ${res.statusText}: ${detail}` : `${res.status} ${res.statusText}`,
      res.status
    );
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new UploadAnnotationError(
      "create",
      "Annotation response was not valid JSON",
      res.status,
      { cause: err }
    );
  }
  try {
    return annotationResponseSchema.parse(json);
  } catch (err) {
    throw new UploadAnnotationError(
      "create",
      "Annotation response failed schema validation",
      res.status,
      { cause: err }
    );
  }
}

async function safeReadText(res: Response): Promise<string | null> {
  try {
    const text = await res.text();
    return text.length > 0 ? text.slice(0, 500) : null;
  } catch {
    return null;
  }
}
