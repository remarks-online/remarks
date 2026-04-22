import { type DB, createClient } from "@remarks/db";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { env } from "../env.js";

declare module "fastify" {
  interface FastifyInstance {
    db: DB;
  }
}

const dbPlugin: FastifyPluginAsync = async (fastify) => {
  const client = createClient(env.DATABASE_URL);
  fastify.decorate("db", client.db);
  fastify.addHook("onClose", async () => {
    await client.sql.end();
  });
};

export default fp(dbPlugin, { name: "db" });
