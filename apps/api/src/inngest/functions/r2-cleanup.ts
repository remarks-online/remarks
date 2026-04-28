import type { R2CleanupRequestedData } from "@remarks/shared";
import { deleteObjects } from "../../lib/r2.js";
import type { R2Client } from "../../lib/r2.js";
import { inngest } from "../client.js";

// Minimal shape of the bits of the Inngest invocation context we use.
// Defining it locally instead of importing from `inngest` keeps the unit
// test free of SDK plumbing — a test passes a stub that just runs the
// callback. Return type is `Promise<unknown>` because Inngest's real
// step.run returns `Promise<Jsonify<T>>` (it serializes the value for
// durability), and we ignore the return value either way.
interface MinimalStep {
  run(id: string, fn: () => Promise<unknown>): Promise<unknown>;
}

interface MinimalLogger {
  info(obj: unknown, msg: string): void;
}

// Pure handler — exported so unit tests can drive it without spinning up
// Inngest. Bulk-deletes the R2 objects named in the event payload.
// Idempotent: DeleteObjects returns success for keys that are already
// gone, so Inngest retries are safe.
export async function runR2Cleanup(
  r2: R2Client,
  data: R2CleanupRequestedData,
  step: MinimalStep,
  logger: MinimalLogger
): Promise<{ deleted: number; origin: string }> {
  const { keys, origin } = data;
  logger.info({ origin, keyCount: keys.length }, "r2-cleanup: starting");
  await step.run("delete-objects", async () => {
    await deleteObjects(r2, keys);
  });
  logger.info({ origin, keyCount: keys.length }, "r2-cleanup: done");
  return { deleted: keys.length, origin };
}

// The R2 client is captured at function-creation time rather than threaded
// through the event payload because (a) it's app-scoped infra, not per-event
// data, and (b) every Inngest function invocation runs in the same Node
// process as the API.
export function createR2CleanupFunction(r2: R2Client) {
  return inngest.createFunction(
    { id: "r2-cleanup", name: "R2 object cleanup" },
    { event: "remarks/r2.cleanup.requested" },
    async ({ event, step, logger }) => runR2Cleanup(r2, event.data, step, logger)
  );
}
