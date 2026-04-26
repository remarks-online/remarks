import { type ClerkClient, createClerkClient, verifyToken } from "@clerk/backend";
import { schema } from "@remarks/db";
import { UnauthorizedError } from "@remarks/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { env } from "../env.js";
import {
  provisionOrgsFromMemberships,
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

export interface AuthPluginOptions {
  clerk?: ClerkClient;
}

const BEARER_PREFIX = "Bearer ";

const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (fastify, opts) => {
  const clerk = opts.clerk ?? createClerkClient({ secretKey: env.CLERK_SECRET_KEY });

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
      const payload = await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY });
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
    } catch (err) {
      request.log.error({ err }, "failed to fetch clerk org memberships");
      throw new UnauthorizedError("Failed to load org memberships");
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

// Wrap with fastify-plugin so the onRequest hook propagates to the registration
// scope (e.g. the `authenticated` child in server.ts) rather than being trapped
// inside this plugin's own encapsulation.
export default fp(authPlugin, { name: "auth" });
