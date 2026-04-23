import { meRouter } from "./procedures/me.js";
import { projectsRouter } from "./procedures/projects.js";
import { router } from "./trpc.js";

export const appRouter = router({
  me: meRouter,
  projects: projectsRouter,
});

export type AppRouter = typeof appRouter;
