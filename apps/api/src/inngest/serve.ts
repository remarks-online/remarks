import type { FastifyPluginAsync } from "fastify";
import { serve } from "inngest/fastify";
import { env } from "../env.js";
import { inngest } from "./client.js";
import { createR2CleanupFunction } from "./functions/r2-cleanup.js";

// Mounted at POST/PUT/GET /inngest. Inngest signs each request with
// INNGEST_SIGNING_KEY; the serve adapter rejects unsigned requests, so this
// route is safe to expose without our own auth middleware.
export const inngestServeRoutes: FastifyPluginAsync = async (fastify) => {
  const handler = serve({
    client: inngest,
    functions: [createR2CleanupFunction(fastify.r2)],
    signingKey: env.INNGEST_SIGNING_KEY,
  });
  fastify.route({
    method: ["GET", "POST", "PUT"],
    url: "/inngest",
    handler,
  });
};
