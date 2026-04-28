import type { AppInngest } from "./client.js";

// Inngest event payload limit is 256KB; S3 DeleteObjects accepts <=1000
// keys per call. Splitting at 500 keeps both well under their respective
// ceilings (~25KB at typical R2 key length, half the S3 batch).
const KEYS_PER_EVENT = 500;

// Publishes one or more `remarks/r2.cleanup.requested` events covering the
// given keys. Best-effort: if Inngest publish fails the keys leak (the
// orphan sweeper — see spec-gaps A## — is the eventual reaper) but the DB
// row is already gone, so we log rather than throw.
//
// `origin` is a free-form correlation tag like `"annotation:<uuid>"` so
// log entries on the publish side and on the worker side line up.
export async function publishR2Cleanup(
  inngest: AppInngest,
  keys: string[],
  origin: string
): Promise<void> {
  if (keys.length === 0) return;
  const events = [];
  for (let i = 0; i < keys.length; i += KEYS_PER_EVENT) {
    events.push({
      name: "remarks/r2.cleanup.requested" as const,
      data: { keys: keys.slice(i, i + KEYS_PER_EVENT), origin },
    });
  }
  try {
    await inngest.send(events);
  } catch (err) {
    console.error("[r2-cleanup] failed to publish event", {
      origin,
      keyCount: keys.length,
      eventCount: events.length,
      err,
    });
  }
}
