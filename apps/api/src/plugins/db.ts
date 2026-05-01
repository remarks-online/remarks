import { type DB, type Sql, createClient } from "@remarks/db";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { env } from "../env.js";

declare module "fastify" {
  interface FastifyInstance {
    db: DB;
    // Underlying postgres-js client. Exposed so plugins that need LISTEN /
    // NOTIFY (G9 SSE event bus) reuse the same connection pool instead of
    // opening a parallel pool. Drizzle is the primary read/write surface;
    // `sql` is for narrow channel-pubsub use only.
    sql: Sql;
  }
}

const dbPlugin: FastifyPluginAsync = async (fastify) => {
  const client = createClient(env.DATABASE_URL);
  fastify.decorate("db", client.db);
  fastify.decorate("sql", client.sql);
  fastify.addHook("onClose", async () => {
    await client.sql.end();
  });
};

export default fp(dbPlugin, { name: "db" });
