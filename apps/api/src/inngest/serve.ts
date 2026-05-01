import type { FastifyPluginAsync } from "fastify";
import { serve } from "inngest/fastify";
import { env } from "../env.js";
import { inngest } from "./client.js";
import { createR2CleanupFunction } from "./functions/r2-cleanup.js";
import { createR2OrphanSweepFunction } from "./functions/r2-orphan-sweep.js";

// Mounted at POST/PUT/GET /inngest. Inngest signs each request with
// INNGEST_SIGNING_KEY; the serve adapter rejects unsigned requests, so this
// route is safe to expose without our own auth middleware.
export const inngestServeRoutes: FastifyPluginAsync = async (fastify) => {
  const handler = serve({
    client: inngest,
    functions: [
      createR2CleanupFunction(fastify.r2),
      createR2OrphanSweepFunction(fastify.r2, fastify.db),
    ],
    signingKey: env.INNGEST_SIGNING_KEY,
  });
  fastify.route({
    method: ["GET", "POST", "PUT"],
    url: "/inngest",
    handler,
  });
};
