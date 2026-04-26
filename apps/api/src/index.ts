import { env } from "./env.js";
import { shutdownAnalytics } from "./lib/posthog.js";
import { buildServer } from "./server.js";

const server = await buildServer();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.log.info({ signal }, "shutdown signal received");
    Promise.resolve(server.close())
      // Flush any in-flight PostHog events before exit so we don't lose them
      // on a Fly machine restart.
      .then(() => shutdownAnalytics())
      .then(() => process.exit(0))
      .catch((err) => {
        server.log.error({ err }, "error during shutdown");
        process.exit(1);
      });
  });
}

try {
  await server.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  server.log.error({ err }, "failed to start server");
  process.exit(1);
}
