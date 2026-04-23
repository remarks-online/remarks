import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import type { Context } from "./trpc.js";

export function createContext({ req }: CreateFastifyContextOptions): Context {
  return {
    user: req.auth?.user,
    orgMemberships: req.auth?.orgMemberships ?? [],
    db: req.server.db,
    requestId: req.id,
  };
}
