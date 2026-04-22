import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyRequest {
    rawBody: Buffer;
  }
}

// Replaces the default application/json parser so webhook handlers can verify
// Svix signatures against the exact request bytes. Parsed JSON is still
// available on request.body for all other routes.
const rawBodyPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    const buf = body as Buffer;
    req.rawBody = buf;
    if (buf.length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(buf.toString("utf8")));
    } catch (err) {
      done(err as Error, undefined);
    }
  });
};

export default fp(rawBodyPlugin, { name: "raw-body" });
