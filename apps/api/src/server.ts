import sensible from "@fastify/sensible";
import { RemarksError, ValidationError } from "@remarks/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { env } from "./env.js";
import authPlugin from "./plugins/auth.js";
import dbPlugin from "./plugins/db.js";
import rawBodyPlugin from "./plugins/raw-body.js";
import { healthRoutes } from "./routes/health.js";
import { clerkWebhookRoutes } from "./routes/webhooks/clerk.js";

export async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },
    requestIdHeader: "x-request-id",
    genReqId: () => crypto.randomUUID(),
    disableRequestLogging: false,
  });

  server.setErrorHandler((err, request, reply) => {
    request.log.error({ err }, "request errored");

    if (err instanceof RemarksError) {
      const body: {
        error: {
          code: string;
          message: string;
          requestId: string;
          issues?: unknown;
        };
      } = {
        error: {
          code: err.code,
          message: err.exposed ? err.message : "Internal server error",
          requestId: request.id,
        },
      };
      if (err instanceof ValidationError && err.issues !== undefined) {
        body.error.issues = err.issues;
      }
      return reply.status(err.statusCode).send(body);
    }

    return reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        requestId: request.id,
      },
    });
  });

  await server.register(sensible);
  await server.register(rawBodyPlugin);
  await server.register(dbPlugin);
  await server.register(healthRoutes);
  await server.register(clerkWebhookRoutes);

  await server.register(async (authenticated) => {
    await authenticated.register(authPlugin);
    // Protected routes registered here in Tasks 1.4+
  });

  return server;
}
