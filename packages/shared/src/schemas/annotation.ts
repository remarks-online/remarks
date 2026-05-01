import { z } from "zod";
import {
  ANNOTATION_INTENTS,
  ANNOTATION_SEVERITIES,
  ANNOTATION_STATUSES,
  ANNOTATION_TARGET_TYPES,
  ASSET_KINDS,
  MAX_BRANCH_NAME_LENGTH,
  MAX_COMMENT_LENGTH,
  MAX_REJECTION_REASON_LENGTH,
  MAX_SELECTOR_LENGTH,
  MAX_TEXT_CONTENT_LENGTH,
  MIN_REJECTION_REASON_LENGTH,
} from "../constants.js";

export const annotationStatusSchema = z.enum(ANNOTATION_STATUSES);

export const annotationTargetTypeSchema = z.enum(ANNOTATION_TARGET_TYPES);

export const annotationSeveritySchema = z.enum(ANNOTATION_SEVERITIES);

export const annotationIntentSchema = z.enum(ANNOTATION_INTENTS);

export const viewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  dpr: z.number().positive(),
});

export const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

export const domContextSchema = z.object({
  tagName: z.string().optional(),
  classes: z.array(z.string()).optional(),
  textContent: z.string().max(MAX_TEXT_CONTENT_LENGTH).optional(),
  computedStyles: z.record(z.string(), z.string()).optional(),
  ancestors: z
    .array(
      z.object({
        tagName: z.string(),
        classes: z.array(z.string()).optional(),
      })
    )
    .optional(),
});

export type DomContextValue = z.infer<typeof domContextSchema>;

// Response-side variant: inner fields are `nullable()` instead of `optional()`
// so the inferred type avoids `| undefined`. tRPC v11's client-side type
// pipeline strips `| undefined` from JSON-serialized responses (JSON can't
// represent undefined), and `exactOptionalPropertyTypes: true` then treats the
// stripped and unstripped shapes as incompatible — `domContextSchema` (used
// for write inputs) is fine because requests roundtrip through zod parsing,
// but the response shape needs every leaf to be `T | null`.
export const domContextResponseSchema = z.object({
  tagName: z.string().nullable(),
  classes: z.array(z.string()).nullable(),
  textContent: z.string().max(MAX_TEXT_CONTENT_LENGTH).nullable(),
  computedStyles: z.record(z.string(), z.string()).nullable(),
  ancestors: z
    .array(
      z.object({
        tagName: z.string(),
        classes: z.array(z.string()).nullable(),
      })
    )
    .nullable(),
});

export type DomContextResponse = z.infer<typeof domContextResponseSchema>;

export const createAnnotationRequestSchema = z
  .object({
    // Both omitted → personal (URL-keyed, owner-private) annotation. Both
    // present → project-scoped. Half-and-half is rejected by the refine below.
    projectId: z.string().uuid().optional(),
    branch: z.string().min(1).max(MAX_BRANCH_NAME_LENGTH).optional(),
    targetType: annotationTargetTypeSchema,
    url: z.string().url(),
    targetSelector: z.string().max(MAX_SELECTOR_LENGTH).optional(),
    targetCoords: rectSchema.optional(),
    viewport: viewportSchema,
    domContext: domContextSchema.optional(),
    frameworkHint: z.string().optional(),
    commentText: z.string().min(1).max(MAX_COMMENT_LENGTH),
    screenshotAssetId: z.string().uuid().optional(),
    // Optional triage classifiers (G1/G2). Both default to null; the dashboard
    // and MCP read paths render a missing value as "uncategorized".
    intent: annotationIntentSchema.optional(),
    severity: annotationSeveritySchema.optional(),
  })
  .refine(
    (data) => {
      if (data.targetType === "element") return !!data.targetSelector;
      if (data.targetType === "rectangle") return !!data.targetCoords;
      return true;
    },
    { message: "Element annotations need selector; rectangle annotations need coords" }
  )
  .refine((data) => Boolean(data.projectId) === Boolean(data.branch), {
    message: "projectId and branch must both be provided or both omitted",
  });

export type CreateAnnotationRequest = z.infer<typeof createAnnotationRequestSchema>;

export const annotationResponseSchema = z.object({
  id: z.string().uuid(),
  // Null for personal (URL-keyed) annotations; set for project-scoped ones.
  projectId: z.string().uuid().nullable(),
  // Project slug, or null for personal annotations. Mirrors `branchName` —
  // useful when callers list across multiple projects (org mode) and need to
  // identify the row's project without a follow-up lookup.
  projectSlug: z.string().nullable(),
  branchId: z.string().uuid().nullable(),
  branchName: z.string().nullable(),
  status: annotationStatusSchema,
  targetType: annotationTargetTypeSchema,
  // G1/G2 triage classifiers. Null when the author left them unset.
  intent: annotationIntentSchema.nullable(),
  severity: annotationSeveritySchema.nullable(),
  url: z.string().url(),
  targetSelector: z.string().nullable(),
  targetCoords: rectSchema.nullable(),
  viewport: viewportSchema,
  // Captured DOM snapshot (tagName, classes, ancestors, computedStyles) for
  // element annotations. Null when the picker captured a region instead, or
  // when the row predates dom-context capture. Inner fields are nullable
  // instead of optional — see domContextResponseSchema for why.
  domContext: domContextResponseSchema.nullable(),
  commentText: z.string(),
  author: z.object({
    id: z.string().uuid(),
    name: z.string().nullable(),
    // Email is nullable because `user.deleted` scrubs it from the users table
    // (see packages/db/src/schema/users.ts). Historical annotations retain a
    // deleted author but expose null for their email.
    email: z.string().email().nullable(),
    avatarUrl: z.string().url().nullable(),
  }),
  assets: z.array(
    z.object({
      id: z.string().uuid(),
      kind: z.enum(ASSET_KINDS),
      url: z.string().url(),
      contentType: z.string(),
    })
  ),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type AnnotationResponse = z.infer<typeof annotationResponseSchema>;

// G4: rejection requires a `reason` that lands in the `status_changed` event
// payload. The refines below enforce the contract — `reason` is mandatory
// (post-trim, ≥ MIN chars) when transitioning to `rejected`, and refused on
// any other status to surface miswired callers early. Trimming happens at the
// schema layer so all consumers see normalized text.
export const rejectionReasonSchema = z
  .string()
  .trim()
  .min(MIN_REJECTION_REASON_LENGTH)
  .max(MAX_REJECTION_REASON_LENGTH);

export const updateAnnotationRequestSchema = z
  .object({
    status: annotationStatusSchema.optional(),
    commentText: z.string().min(1).max(MAX_COMMENT_LENGTH).optional(),
    reason: rejectionReasonSchema.optional(),
  })
  .refine((data) => data.status !== undefined || data.commentText !== undefined, {
    message: "At least one field must be provided",
  })
  .refine((data) => !(data.status === "rejected") || data.reason !== undefined, {
    message: "reason is required when status is rejected",
    path: ["reason"],
  })
  .refine((data) => data.reason === undefined || data.status === "rejected", {
    message: "reason is only allowed when status is rejected",
    path: ["reason"],
  });

export type UpdateAnnotationRequest = z.infer<typeof updateAnnotationRequestSchema>;

export const listAnnotationsQuerySchema = z.object({
  cursor: z.string().optional(),
  // Fastify surfaces query params as strings; coerce before the int/range checks.
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: annotationStatusSchema.optional(),
  branch: z.string().min(1).max(MAX_BRANCH_NAME_LENGTH).optional(),
  url: z.string().url().optional(),
});

export type ListAnnotationsQuery = z.infer<typeof listAnnotationsQuerySchema>;

export const annotationListResponseSchema = z.object({
  items: z.array(annotationResponseSchema),
  nextCursor: z.string().nullable(),
});

export type AnnotationListResponse = z.infer<typeof annotationListResponseSchema>;
