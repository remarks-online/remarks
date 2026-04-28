import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { RemarksError, ValidationError } from "@remarks/shared";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyInstance } from "fastify";
import { env } from "./env.js";
import { inngestServeRoutes } from "./inngest/serve.js";
import authPlugin from "./plugins/auth.js";
import clerkPlugin from "./plugins/clerk.js";
import dbPlugin from "./plugins/db.js";
import inngestPlugin from "./plugins/inngest.js";
import r2Plugin from "./plugins/r2.js";
import rawBodyPlugin from "./plugins/raw-body.js";
import { annotationRoutes } from "./routes/annotations/index.js";
import { healthRoutes } from "./routes/health.js";
import { internalRoutes } from "./routes/internal/index.js";
import { projectRoutes } from "./routes/projects/index.js";
import { uploadRoutes } from "./routes/uploads/index.js";
import { clerkWebhookRoutes } from "./routes/webhooks/clerk.js";
import { createContext } from "./trpc/context.js";
import { type AppRouter, appRouter } from "./trpc/router.js";

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
  // Extension origin is the committed public-key-derived ID from apps/extension/wxt.config.ts.
  // Pinned across all "Load unpacked" installs of this repo. A separate Chrome-Web-Store
  // release would need its own origin added here (see docs/runbooks/extension-clerk-synchost.md).
  const extensionOrigin = "chrome-extension://baikikfefeheiildmfoaicbjbnbecgjd";
  const dashboardOrigin =
    env.NODE_ENV === "production" ? "https://app.remarks.online" : "http://localhost:3000";
  await server.register(cors, {
    origin: [dashboardOrigin, extensionOrigin],
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });
  await server.register(rawBodyPlugin);
  await server.register(dbPlugin);
  await server.register(r2Plugin);
  await server.register(inngestPlugin);
  await server.register(clerkPlugin, {});
  await server.register(healthRoutes);
  await server.register(clerkWebhookRoutes);
  // Inngest serve handler — signature-verified by the SDK, registered at the
  // same scope as Clerk webhooks (no Clerk JWT required).
  await server.register(inngestServeRoutes);
  // Internal MCP-only routes (Phase 2 task 2.5). Registered as its own
  // top-level scope — the internal-auth plugin's onRequest hook is
  // encapsulated here, so /health and /webhooks/* still work without an
  // x-internal-auth header.
  await server.register(internalRoutes);

  await server.register(async (authenticated) => {
    await authenticated.register(authPlugin);
    await authenticated.register(projectRoutes);
    await authenticated.register(uploadRoutes);
    await authenticated.register(annotationRoutes);
    await authenticated.register(fastifyTRPCPlugin<AppRouter>, {
      prefix: "/trpc",
      trpcOptions: {
        router: appRouter,
        createContext,
        onError({ error, path, ctx }) {
          server.log.error(
            { err: error, path, requestId: ctx?.requestId },
            "trpc procedure errored"
          );
        },
      },
    });
  });

  return server;
}
