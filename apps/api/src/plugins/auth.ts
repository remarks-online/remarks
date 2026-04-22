import { type ClerkClient, createClerkClient, verifyToken } from "@clerk/backend";
import { schema } from "@remarks/db";
import { UnauthorizedError } from "@remarks/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { env } from "../env.js";

export interface RequestAuth {
  user: {
    id: string;
    clerkUserId: string;
    email: string | null;
    name: string | null;
    avatarUrl: string | null;
  };
  orgMemberships: Array<{ clerkOrgId: string; role: string }>;
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

    const userRow = await fastify.db.query.users.findFirst({
      where: and(eq(schema.users.clerkUserId, clerkUserId), isNull(schema.users.deletedAt)),
    });
    if (!userRow) {
      throw new UnauthorizedError("User not provisioned");
    }

    let memberships: RequestAuth["orgMemberships"];
    try {
      const list = await clerk.users.getOrganizationMembershipList({ userId: clerkUserId });
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
