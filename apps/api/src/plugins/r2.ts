import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { env } from "../env.js";
import { type R2Client, createR2Client } from "../lib/r2.js";

declare module "fastify" {
  interface FastifyInstance {
    r2: R2Client;
  }
}

const r2Plugin: FastifyPluginAsync = async (fastify) => {
  const client = createR2Client(env);
  fastify.decorate("r2", client);
  fastify.addHook("onClose", async () => {
    client.s3.destroy();
  });
};

export default fp(r2Plugin, { name: "r2" });
