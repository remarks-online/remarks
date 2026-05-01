import { type DB, schema } from "@remarks/db";
import { deleteObjects, listAllObjects } from "../../lib/r2.js";
import type { R2Client } from "../../lib/r2.js";
import { inngest } from "../client.js";

// See r2-cleanup.ts for the rationale behind this minimal step shape:
// avoids importing Inngest types so the unit test can drive the pure handler
// with a passthrough stub. Inngest's real step.run returns Promise<Jsonify<T>>;
// our caller casts when it needs to consume the value.
interface MinimalStep {
  run(id: string, fn: () => Promise<unknown>): Promise<unknown>;
}

interface MinimalLogger {
  info(obj: unknown, msg: string): void;
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const DELETE_BATCH_SIZE = 1000;

export interface R2OrphanSweepDeps {
  r2: R2Client;
  // Function form (not `DB`) keeps the unit test free of drizzle. The
  // factory wires in the default DB-backed implementation below.
  fetchReferencedKeys: () => Promise<Set<string>>;
  step: MinimalStep;
  logger: MinimalLogger;
  now: () => Date;
  graceMillis: number;
}

export interface R2OrphanSweepResult {
  scanned: number;
  deleted: number;
  skippedYoung: number;
  skippedReferenced: number;
  batches: number;
}

// Reaps R2 keys not referenced by `annotation_assets`. Backstops two leak
// paths: Phase 1 orphans (created before issue #76's on-delete cleanup
// shipped) and best-effort `publishR2Cleanup` failures where the DB delete
// committed but the Inngest event never landed. Grace window is on R2's
// LastModified, not the DB row's createdAt — orphans by definition have no
// DB row, and the leak window is "object exists in R2 before its row is
// written." Order-of-operations matters: query DB first, then list R2; rows
// created during the read-list interval are protected by the grace window.
export async function runR2OrphanSweep(deps: R2OrphanSweepDeps): Promise<R2OrphanSweepResult> {
  const { r2, fetchReferencedKeys, step, logger, now, graceMillis } = deps;

  // step.run output is JSON-memoized by Inngest, and a Set doesn't survive
  // that — return string[] from the closure and rebuild the Set out here.
  // Cast: Inngest's runtime return is Jsonify<string[]> which is just
  // string[], but our minimal step interface returns unknown.
  const referencedArr = (await step.run("query-db", async () => {
    const set = await fetchReferencedKeys();
    return Array.from(set);
  })) as string[];
  const referenced = new Set(referencedArr);

  const cutoff = now().getTime() - graceMillis;
  let scanned = 0;
  let deleted = 0;
  let skippedYoung = 0;
  let skippedReferenced = 0;
  let batchIndex = 0;

  // List pagination is intentionally NOT wrapped in step.run. ListObjectsV2
  // is read-only/idempotent on retry, and the full key list could exceed
  // Inngest's per-step output cap if memoized. Each delete batch IS its own
  // step so a transient DeleteObjects failure retries one chunk, not the
  // whole sweep.
  for await (const page of listAllObjects(r2)) {
    scanned += page.length;
    const toDelete: string[] = [];
    for (const obj of page) {
      if (referenced.has(obj.key)) {
        skippedReferenced++;
        continue;
      }
      if (obj.lastModified.getTime() > cutoff) {
        skippedYoung++;
        continue;
      }
      toDelete.push(obj.key);
    }
    for (let i = 0; i < toDelete.length; i += DELETE_BATCH_SIZE) {
      const chunk = toDelete.slice(i, i + DELETE_BATCH_SIZE);
      const stepId = `delete-batch-${batchIndex++}`;
      await step.run(stepId, async () => {
        await deleteObjects(r2, chunk);
        return chunk.length;
      });
      deleted += chunk.length;
    }
  }

  const result: R2OrphanSweepResult = {
    scanned,
    deleted,
    skippedYoung,
    skippedReferenced,
    batches: batchIndex,
  };
  logger.info(result, "r2-orphan-sweep complete");
  return result;
}

// Default DB-backed implementation of fetchReferencedKeys. Loads every
// `annotation_assets.r2_key` into a Set for O(1) membership checks during
// the R2 scan. Memory bound: ~70 bytes/key × N rows. At 10M rows that's
// ~700MB — fine on Fly. If the table ever crosses that, switch to a
// cursor-based "list R2 then probe DB per page" approach.
export async function fetchAnnotationAssetKeys(db: DB): Promise<Set<string>> {
  const rows = await db
    .select({ r2Key: schema.annotationAssets.r2Key })
    .from(schema.annotationAssets);
  return new Set(rows.map((r) => r.r2Key));
}

// First cron-triggered function in the repo. Cron syntax docs:
// https://www.inngest.com/docs/guides/scheduled-functions
export function createR2OrphanSweepFunction(r2: R2Client, db: DB) {
  return inngest.createFunction(
    { id: "r2-orphan-sweep", name: "R2 orphan sweep" },
    { cron: "0 3 * * *" },
    async ({ step, logger }) =>
      runR2OrphanSweep({
        r2,
        fetchReferencedKeys: () => fetchAnnotationAssetKeys(db),
        step,
        logger,
        now: () => new Date(),
        graceMillis: TWENTY_FOUR_HOURS_MS,
      })
  );
}
