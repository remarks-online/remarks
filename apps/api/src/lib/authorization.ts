import { ForbiddenError } from "@remarks/shared";
import type { FastifyRequest } from "fastify";
import {
  PROJECT_ROLE_RANK,
  type ProjectRole,
  assertProjectMember,
} from "./project-authorization.js";

// Re-exported for existing call sites that read the role rank or the pure
// helper from this module. Splitting kept `project-authorization.ts` free of
// Fastify types so the tRPC import graph doesn't drag in Fastify augmentations
// (`request.auth`, `fastify.db`) that aren't visible outside the api's
// compilation — e.g. from the dashboard's type-only import of AppRouter.
export { PROJECT_ROLE_RANK, assertProjectMember };
export type { ProjectRole };

const CLERK_ADMIN_ROLE = "org:admin";

export function requireOrgMember(
  request: FastifyRequest,
  clerkOrgId: string,
  opts: { role?: "admin" } = {}
): { clerkOrgId: string; role: string } {
  const membership = request.auth.orgMemberships.find((m) => m.clerkOrgId === clerkOrgId);
  if (!membership) {
    throw new ForbiddenError("Not a member of this organization");
  }
  if (opts.role === "admin" && membership.role !== CLERK_ADMIN_ROLE) {
    throw new ForbiddenError("Requires organization admin");
  }
  return membership;
}

export async function requireProjectMember(
  request: FastifyRequest,
  projectId: string,
  opts: { minRole?: ProjectRole } = {}
): Promise<{ role: ProjectRole }> {
  return assertProjectMember(request.server.db, request.auth.user.id, projectId, opts);
}
