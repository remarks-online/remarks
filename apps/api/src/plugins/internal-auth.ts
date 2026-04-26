import { timingSafeEqual } from "node:crypto";
import { UnauthorizedError } from "@remarks/shared";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { env } from "../env.js";

const HEADER = "x-internal-auth";

// Gates the /internal/* scope (Phase 2 spec §5.4). The MCP server is the only
// caller; on Fly the request lands over private VPC networking, but the shared
// secret is the load-bearing check — never assume the network alone is enough.
// timingSafeEqual short-circuits on length mismatch first, so non-equal-length
// inputs don't reach the constant-time path.
const internalAuthPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", async (request) => {
    const provided = request.headers[HEADER];
    if (typeof provided !== "string") {
      throw new UnauthorizedError("Missing internal auth header");
    }
    const expected = Buffer.from(env.INTERNAL_API_TOKEN);
    const actual = Buffer.from(provided);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new UnauthorizedError("Invalid internal auth header");
    }
  });
};

// Wrap with fastify-plugin so the onRequest hook propagates to the parent
// registration scope (server.ts wraps internal routes in a child scope after
// this plugin), mirroring apps/api/src/plugins/auth.ts.
export default fp(internalAuthPlugin, { name: "internal-auth" });
