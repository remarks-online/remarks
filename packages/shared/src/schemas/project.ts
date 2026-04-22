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

export const projectResponseSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  gitRepoUrl: z.string().url().nullable(),
  primaryBranch: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ProjectResponse = z.infer<typeof projectResponseSchema>;
