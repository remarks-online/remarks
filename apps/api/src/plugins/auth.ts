import { verifyToken } from "@clerk/backend";
import { schema } from "@remarks/db";
import { UnauthorizedError } from "@remarks/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { env } from "../env.js";
import {
  provisionOrgsFromMemberships,
  provisionProjectMembersFromOrgMemberships,
  provisionUserFromClerk,
} from "../services/clerk-sync.service.js";

import type { AuthenticatedUser, OrgMembership } from "../trpc/trpc.js";

export interface RequestAuth {
  user: AuthenticatedUser;
  orgMemberships: OrgMembership[];
}

declare module "fastify" {
  interface FastifyRequest {
    auth: RequestAuth;
  }
}

const BEARER_PREFIX = "Bearer ";

const authPlugin: FastifyPluginAsync = async (fastify) => {
  const clerk = fastify.clerk;

  // Pre-declare the `auth` property so Fastify preserves V8's hidden class
  // across requests. The actual value is assigned by the onRequest hook below.
  fastify.decorateRequest("auth", null as unknown as RequestAuth);

  fastify.addHook("onRequest", async (request) => {
    const header = request.headers.authorization;
    if (typeof header !== "string" || !header.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedError("Missing bearer token");
    }
    const token = header.slice(BEARER_PREFIX.length).trim();
    if (token.length === 0) {
      throw new UnauthorizedError("Missing bearer token");
    }

    let clerkUserId: string;
    try {
      const payload = await verifyToken(token, {
        secretKey: env.CLERK_SECRET_KEY,
        authorizedParties: env.CLERK_AUTHORIZED_PARTIES,
      });
      clerkUserId = payload.sub;
    } catch (err) {
      request.log.warn({ err }, "clerk token verification failed");
      throw new UnauthorizedError("Invalid or expired token");
    }

    let userRow = await fastify.db.query.users.findFirst({
      where: and(eq(schema.users.clerkUserId, clerkUserId), isNull(schema.users.deletedAt)),
    });
    if (!userRow) {
      // Backstop for /webhooks/clerk: local dev runs without ngrok, and prod
      // webhooks can lag/fail. Fetch the Clerk user and upsert in-line so the
      // first authenticated request after sign-up doesn't 401.
      try {
        userRow = (await provisionUserFromClerk(fastify.db, clerk, clerkUserId)) ?? undefined;
      } catch (err) {
        request.log.warn({ err, clerkUserId }, "lazy user provisioning failed");
        throw new UnauthorizedError("Failed to load Clerk user");
      }
      if (!userRow) {
        throw new UnauthorizedError("User provisioning failed");
      }
    }

    let memberships: RequestAuth["orgMemberships"];
    try {
      const list = await clerk.users.getOrganizationMembershipList({ userId: clerkUserId });
      // Backstop the organization.* webhooks the same way the user lookup
      // backstops user.created — ensures every org the caller is a member of
      // exists locally before downstream procedures dereference it.
      await provisionOrgsFromMemberships(fastify.db, list.data);
      memberships = list.data.map((m) => ({
        clerkOrgId: m.organization.id,
        role: m.role,
      }));
      // Sibling backstop for organizationMembership.* webhooks: ensures the
      // caller has a project_members row on every project in their orgs so
      // assertProjectMember-gated procedures (annotations.list/get/update,
      // upload presigning, project edit) succeed for invited teammates the
      // moment they sign in. Idempotent NOT EXISTS anti-join — no inserts
      // fire on warm requests where membership is already in sync.
      await provisionProjectMembersFromOrgMemberships(fastify.db, userRow.id, memberships);
    } catch (err) {
      // Tolerate the case where Clerk's Organizations feature is disabled at
      // the instance level: personal-first users don't need orgs, and a single
      // dashboard toggle shouldn't 401 every authenticated request.
      if (isClerkOrgsDisabledError(err)) {
        request.log.warn(
          { clerkUserId },
          "clerk organizations feature disabled; treating user as personal-only"
        );
        memberships = [];
      } else {
        request.log.error({ err }, "failed to fetch clerk org memberships");
        throw new UnauthorizedError("Failed to load org memberships");
      }
    }

    request.auth = {
      user: {
        id: userRow.id,
        clerkUserId: userRow.clerkUserId,
        email: userRow.email,
        name: userRow.name,
        avatarUrl: userRow.avatarUrl,
      },
      orgMemberships: memberships,
    };
  });
};

// True when the Clerk SDK throws because the Organizations feature is off in
// the current Clerk instance. The SDK surfaces this as a 403 with a code of
// `organization_not_enabled_in_instance` inside the `errors` array.
function isClerkOrgsDisabledError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const errors = (err as { errors?: Array<{ code?: string }> }).errors;
  if (!Array.isArray(errors)) return false;
  return errors.some((e) => e?.code === "organization_not_enabled_in_instance");
}

// Wrap with fastify-plugin so the onRequest hook propagates to the registration
// scope (e.g. the `authenticated` child in server.ts) rather than being trapped
// inside this plugin's own encapsulation.
export default fp(authPlugin, { name: "auth" });
