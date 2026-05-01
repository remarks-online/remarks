import { randomUUID } from "node:crypto";
import { schema } from "@remarks/db";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  closeIntegrationDb,
  getIntegrationDb,
  seedUser,
  truncateAll,
} from "../../../test/integration/db.js";
import { ensureBucket, readR2EnvOrThrow } from "../../../test/integration/r2.js";
import {
  type R2Client,
  createR2Client,
  deleteObjects,
  headObject,
  putObject,
} from "../../lib/r2.js";
import { fetchAnnotationAssetKeys, runR2OrphanSweep } from "./r2-orphan-sweep.js";

const passthroughStep = {
  async run<T>(_id: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  },
};

const silentLogger = { info: vi.fn() };

describe("r2-orphan-sweep (integration)", () => {
  let r2: R2Client;
  const testRunPrefix = `sweep-test/${randomUUID()}`;
  const orphanKey = `${testRunPrefix}/orphan.png`;
  const referencedKey = `${testRunPrefix}/referenced.png`;

  beforeAll(async () => {
    r2 = createR2Client(readR2EnvOrThrow());
    await ensureBucket(r2);
    // Boot the DB once so the migrate runs before any test seeds rows.
    await getIntegrationDb();
  });

  afterAll(async () => {
    // Belt-and-braces — drop any keys this run created in case a test
    // failed mid-way.
    await deleteObjects(r2, [orphanKey, referencedKey]).catch(() => undefined);
    r2.s3.destroy();
    await closeIntegrationDb();
  });

  beforeEach(async () => {
    await truncateAll();
    // Each test puts the objects fresh so LastModified is current. Delete
    // any leftover from prior tests in this run; idempotent on missing keys.
    await deleteObjects(r2, [orphanKey, referencedKey]);
  });

  test("orphan deleted, referenced kept", async () => {
    const db = await getIntegrationDb();
    const user = await seedUser(db);
    // Personal annotation: projectId/branchId both null per the
    // project_branch_consistency check on the annotations table.
    const [annotation] = await db
      .insert(schema.annotations)
      .values({
        authorId: user.id,
        targetType: "element",
        url: "https://example.com",
        targetSelector: "body",
        viewport: { width: 1920, height: 1080, dpr: 2 },
        commentText: "test",
      })
      .returning();
    if (!annotation) throw new Error("annotation insert returned no rows");
    await db.insert(schema.annotationAssets).values({
      annotationId: annotation.id,
      kind: "screenshot",
      r2Key: referencedKey,
      contentType: "image/png",
      sizeBytes: 1,
    });

    await putObject(r2, {
      key: orphanKey,
      body: Buffer.from("o"),
      contentType: "image/png",
    });
    await putObject(r2, {
      key: referencedKey,
      body: Buffer.from("r"),
      contentType: "image/png",
    });

    // graceMillis: 0 so freshly-uploaded keys are eligible for deletion.
    const result = await runR2OrphanSweep({
      r2,
      fetchReferencedKeys: () => fetchAnnotationAssetKeys(db),
      step: passthroughStep,
      logger: silentLogger,
      now: () => new Date(),
      graceMillis: 0,
    });

    // The bucket may contain residue from earlier test runs; assert on the
    // counters that reflect this run's two seeded keys.
    expect(result.scanned).toBeGreaterThanOrEqual(2);
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(result.skippedReferenced).toBeGreaterThanOrEqual(1);
    expect(result.batches).toBeGreaterThanOrEqual(1);

    expect(await headObject(r2, { key: orphanKey })).toBeNull();
    expect(await headObject(r2, { key: referencedKey })).not.toBeNull();
  });

  test("grace window protects young objects", async () => {
    const db = await getIntegrationDb();

    await putObject(r2, {
      key: orphanKey,
      body: Buffer.from("o"),
      contentType: "image/png",
    });
    await putObject(r2, {
      key: referencedKey,
      body: Buffer.from("r"),
      contentType: "image/png",
    });

    // graceMillis: 60_000 — both objects were just uploaded, so both are
    // younger than the cutoff.
    const result = await runR2OrphanSweep({
      r2,
      fetchReferencedKeys: () => fetchAnnotationAssetKeys(db),
      step: passthroughStep,
      logger: silentLogger,
      now: () => new Date(),
      graceMillis: 60_000,
    });

    expect(result.deleted).toBe(0);
    expect(result.skippedYoung).toBeGreaterThanOrEqual(2);
    expect(await headObject(r2, { key: orphanKey })).not.toBeNull();
    expect(await headObject(r2, { key: referencedKey })).not.toBeNull();
  });
});
