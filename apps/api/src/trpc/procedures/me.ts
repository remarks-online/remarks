import { currentUserSchema } from "@remarks/shared";
import { protectedProcedure, router } from "../trpc.js";

export const meRouter = router({
  getCurrentUser: protectedProcedure.query(({ ctx }) => {
    const output = {
      user: {
        id: ctx.user.id,
        clerkUserId: ctx.user.clerkUserId,
        email: ctx.user.email,
        name: ctx.user.name,
        avatarUrl: ctx.user.avatarUrl,
      },
      orgMemberships: ctx.orgMemberships,
    };
    return currentUserSchema.parse(output);
  }),
});
