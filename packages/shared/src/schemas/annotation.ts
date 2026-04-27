import { z } from "zod";
import {
  ANNOTATION_STATUSES,
  ANNOTATION_TARGET_TYPES,
  ASSET_KINDS,
  MAX_BRANCH_NAME_LENGTH,
  MAX_COMMENT_LENGTH,
  MAX_SELECTOR_LENGTH,
  MAX_TEXT_CONTENT_LENGTH,
} from "../constants.js";

export const annotationStatusSchema = z.enum(ANNOTATION_STATUSES);

export const annotationTargetTypeSchema = z.enum(ANNOTATION_TARGET_TYPES);

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
  branchId: z.string().uuid().nullable(),
  branchName: z.string().nullable(),
  status: annotationStatusSchema,
  targetType: annotationTargetTypeSchema,
  url: z.string().url(),
  targetSelector: z.string().nullable(),
  targetCoords: rectSchema.nullable(),
  viewport: viewportSchema,
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

export const updateAnnotationRequestSchema = z
  .object({
    status: annotationStatusSchema.optional(),
    commentText: z.string().min(1).max(MAX_COMMENT_LENGTH).optional(),
  })
  .refine((data) => data.status !== undefined || data.commentText !== undefined, {
    message: "At least one field must be provided",
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
