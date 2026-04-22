import { env } from "./env.js";
import { buildServer } from "./server.js";

const server = await buildServer();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.log.info({ signal }, "shutdown signal received");
    server
      .close()
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
