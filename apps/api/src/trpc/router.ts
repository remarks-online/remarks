import { meRouter } from "./procedures/me.js";
import { router } from "./trpc.js";

export const appRouter = router({
  me: meRouter,
});

export type AppRouter = typeof appRouter;
