import { type ClerkClient, createClerkClient } from "@clerk/backend";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { env } from "../env.js";

declare module "fastify" {
  interface FastifyInstance {
    clerk: ClerkClient;
  }
}

export interface ClerkPluginOptions {
  clerk?: ClerkClient;
}

const clerkPlugin: FastifyPluginAsync<ClerkPluginOptions> = async (fastify, opts) => {
  const client = opts.clerk ?? createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  fastify.decorate("clerk", client);
};

export default fp(clerkPlugin, { name: "clerk" });
