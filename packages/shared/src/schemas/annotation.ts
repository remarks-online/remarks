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
    projectId: z.string().uuid(),
    branch: z.string().min(1).max(MAX_BRANCH_NAME_LENGTH),
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
  );

export type CreateAnnotationRequest = z.infer<typeof createAnnotationRequestSchema>;

export const annotationResponseSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  branchId: z.string().uuid(),
  branchName: z.string(),
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
    email: z.string().email(),
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
