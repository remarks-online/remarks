import type { FastifyInstance } from "fastify";
import internalAuthPlugin from "../../plugins/internal-auth.js";
import { annotationInternalRoutes } from "./annotations.js";
import { projectInternalRoutes } from "./projects.js";
import { userProjectsRoutes } from "./user-projects.js";
import { whoamiRoutes } from "./whoami.js";

// /internal/* — service-to-service endpoints reachable only from the MCP
// server (Phase 2 spec §5.4). Wraps every internal route in the
// internal-auth plugin so `x-internal-auth` is enforced before any handler
// runs. This function is itself registered inside an encapsulated child
// scope from server.ts, which keeps the auth hook from leaking out to the
// public /health and /webhooks/* routes.
export async function internalRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(internalAuthPlugin);
  await fastify.register(userProjectsRoutes);
  await fastify.register(whoamiRoutes);
  await fastify.register(projectInternalRoutes);
  await fastify.register(annotationInternalRoutes);
}
