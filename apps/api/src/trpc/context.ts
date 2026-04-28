import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import type { Context } from "./trpc.js";

export function createContext({ req }: CreateFastifyContextOptions): Context {
  return {
    user: req.auth?.user,
    orgMemberships: req.auth?.orgMemberships ?? [],
    db: req.server.db,
    r2: req.server.r2,
    clerk: req.server.clerk,
    inngest: req.server.inngest,
    requestId: req.id,
  };
}
