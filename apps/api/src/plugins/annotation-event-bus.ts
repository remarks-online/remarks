import { createListenClient } from "@remarks/db";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { env } from "../env.js";
import { AnnotationEventBus } from "../lib/annotation-event-bus.js";

declare module "fastify" {
  interface FastifyInstance {
    annotationEventBus: AnnotationEventBus;
  }
}

// Ring buffer size — replays beyond this read from `annotationEvents`. 256 is
// roughly 30s of activity at 8 events/second, which exceeds the round-trip a
// reconnecting client needs. Tuneable, but not via env until we have evidence.
const BUFFER_SIZE = 256;

const annotationEventBusPlugin: FastifyPluginAsync = async (fastify) => {
  // Dedicated client for LISTEN — see createListenClient docstring.
  const listenSql = createListenClient(env.DATABASE_URL);
  const bus = new AnnotationEventBus({
    notifySql: fastify.sql,
    listenSql,
    maxConnections: env.MAX_SSE_CONNECTIONS,
    bufferSize: BUFFER_SIZE,
    logger: {
      info: (...args) => fastify.log.info(...(args as [object, string?])),
      warn: (...args) => fastify.log.warn(...(args as [object, string?])),
      error: (...args) => fastify.log.error(...(args as [object, string?])),
    },
  });
  // Lazy: bus.start() runs on the first subscribe() to keep the LISTEN socket
  // off the boot path (avoids interfering with rapid integration-test cycles
  // that build/tear-down servers in series).
  fastify.decorate("annotationEventBus", bus);
  fastify.addHook("onClose", async () => {
    await bus.close();
  });
};

export default fp(annotationEventBusPlugin, { name: "annotation-event-bus", dependencies: ["db"] });
