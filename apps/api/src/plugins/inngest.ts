import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { type AppInngest, inngest } from "../inngest/client.js";

declare module "fastify" {
  interface FastifyInstance {
    inngest: AppInngest;
  }
}

const inngestPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate("inngest", inngest);
};

export default fp(inngestPlugin, { name: "inngest" });
