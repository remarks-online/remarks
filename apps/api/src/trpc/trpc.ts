import type { ClerkClient } from "@clerk/backend";
import type { DB } from "@remarks/db";
import { RemarksError, UnauthorizedError, ValidationError } from "@remarks/shared";
import { TRPCError, initTRPC } from "@trpc/server";
import type { AppInngest } from "../inngest/client.js";
import type { R2Client } from "../lib/r2.js";

// User shape inlined (rather than imported from plugins/auth.ts) so the
// dashboard's type-only import of AppRouter doesn't transitively pull in
// Fastify-instance decorations (e.g. `fastify.db`) that are only augmented
// inside the api app's compilation context.
export interface AuthenticatedUser {
  id: string;
  clerkUserId: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export interface OrgMembership {
  clerkOrgId: string;
  role: string;
}

export interface Context {
  user?: AuthenticatedUser;
  orgMemberships: OrgMembership[];
  db: DB;
  r2: R2Client;
  clerk: ClerkClient;
  inngest: AppInngest;
  requestId: string;
}

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    const cause = error.cause;
    if (cause instanceof RemarksError) {
      return {
        ...shape,
        data: {
          ...shape.data,
          code: cause.code,
          httpStatus: cause.statusCode,
          exposed: cause.exposed,
          issues: cause instanceof ValidationError ? cause.issues : undefined,
        },
      };
    }
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      cause: new UnauthorizedError(),
      message: "Unauthorized",
    });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});
