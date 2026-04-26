import { z } from "zod";
import {
  MAX_PROJECT_NAME_LENGTH,
  MAX_PROJECT_SLUG_LENGTH,
  PROJECT_ROLES,
  PROJECT_SLUG_REGEX,
} from "../constants.js";

export const projectRoleSchema = z.enum(PROJECT_ROLES);

export const createProjectRequestSchema = z.object({
  name: z.string().min(1).max(MAX_PROJECT_NAME_LENGTH),
  slug: z
    .string()
    .min(1)
    .max(MAX_PROJECT_SLUG_LENGTH)
    .regex(PROJECT_SLUG_REGEX, "Slug must be lowercase alphanumeric with dashes"),
  gitRepoUrl: z.string().url().optional(),
  primaryBranch: z.string().default("main"),
});

export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

// `gitRepoUrl: null` clears the existing value; `undefined` (key absent) is "no
// change". The service layer distinguishes the two via `"gitRepoUrl" in input`.
export const updateProjectRequestSchema = z
  .object({
    name: z.string().min(1).max(MAX_PROJECT_NAME_LENGTH).optional(),
    slug: z
      .string()
      .min(1)
      .max(MAX_PROJECT_SLUG_LENGTH)
      .regex(PROJECT_SLUG_REGEX, "Slug must be lowercase alphanumeric with dashes")
      .optional(),
    gitRepoUrl: z.union([z.string().url(), z.null()]).optional(),
    primaryBranch: z.string().min(1).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.slug !== undefined ||
      v.gitRepoUrl !== undefined ||
      v.primaryBranch !== undefined,
    { message: "At least one field must be provided" }
  );

export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

export const projectResponseSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  gitRepoUrl: z.string().url().nullable(),
  primaryBranch: z.string(),
  // Caller's role on this project, or null when the caller is an org member
  // but not a project member. The dashboard gates destructive actions on this;
  // server-side mutations re-check via assertProjectMember.
  myRole: projectRoleSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ProjectResponse = z.infer<typeof projectResponseSchema>;
