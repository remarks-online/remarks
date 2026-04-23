import { annotationsRouter } from "./procedures/annotations.js";
import { meRouter } from "./procedures/me.js";
import { projectsRouter } from "./procedures/projects.js";
import { router } from "./trpc.js";

export const appRouter = router({
  me: meRouter,
  projects: projectsRouter,
  annotations: annotationsRouter,
});

export type AppRouter = typeof appRouter;
