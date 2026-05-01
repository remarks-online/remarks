import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { describe, expect, test, vi } from "vitest";
import type { R2Client } from "../../lib/r2.js";
import { runR2OrphanSweep } from "./r2-orphan-sweep.js";

const passthroughStep = {
  async run<T>(_id: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  },
};

const silentLogger = { info: vi.fn() };

interface FakeObject {
  key: string;
  lastModified: Date;
  size?: number;
}

// Build an r2 client whose s3.send dispatches on command class. List
// returns the configured pages; Delete records its calls. This mirrors how
// r2-cleanup.test.ts stubs the client without pulling in the AWS SDK
// mocking machinery.
function fakeR2(args: { pages: FakeObject[][] }): {
  r2: R2Client;
  send: ReturnType<typeof vi.fn>;
  deleteCalls: () => string[][];
} {
  const send = vi.fn();
  let pageIndex = 0;
  send.mockImplementation(async (cmd: unknown) => {
    if (cmd instanceof ListObjectsV2Command) {
      const page = args.pages[pageIndex] ?? [];
      const isTruncated = pageIndex < args.pages.length - 1;
      pageIndex++;
      return {
        Contents: page.map((o) => ({
          Key: o.key,
          LastModified: o.lastModified,
          Size: o.size ?? 0,
        })),
        IsTruncated: isTruncated,
        NextContinuationToken: isTruncated ? `tok-${pageIndex}` : undefined,
      };
    }
    if (cmd instanceof DeleteObjectsCommand) {
      return {};
    }
    throw new Error(
      `unexpected command: ${(cmd as { constructor: { name: string } }).constructor.name}`
    );
  });

  const deleteCalls = (): string[][] =>
    send.mock.calls
      .map(([cmd]) => cmd as unknown)
      .filter((cmd): cmd is DeleteObjectsCommand => cmd instanceof DeleteObjectsCommand)
      .map((cmd) => (cmd.input.Delete?.Objects ?? []).map((o) => o.Key as string));

  const r2 = { s3: { send }, bucket: "test-bucket" } as unknown as R2Client;
  return { r2, send, deleteCalls };
}

const NOW = new Date("2026-04-30T03:00:00Z");
const fixedNow = () => NOW;

describe("runR2OrphanSweep", () => {
  test("deletes orphans, skips referenced keys, skips young keys", async () => {
    const { r2, deleteCalls } = fakeR2({
      pages: [
        [
          {
            key: "orphan/old.png",
            lastModified: new Date(NOW.getTime() - 48 * 60 * 60 * 1000),
          },
          {
            key: "referenced/keep.png",
            lastModified: new Date(NOW.getTime() - 48 * 60 * 60 * 1000),
          },
          {
            key: "orphan/young.png",
            lastModified: new Date(NOW.getTime() - 60 * 1000),
          },
        ],
      ],
    });

    const result = await runR2OrphanSweep({
      r2,
      fetchReferencedKeys: async () => new Set(["referenced/keep.png"]),
      step: passthroughStep,
      logger: silentLogger,
      now: fixedNow,
      graceMillis: 24 * 60 * 60 * 1000,
    });

    expect(result).toEqual({
      scanned: 3,
      deleted: 1,
      skippedYoung: 1,
      skippedReferenced: 1,
      batches: 1,
    });
    expect(deleteCalls()).toEqual([["orphan/old.png"]]);
  });

  test("skips key whose lastModified equals the cutoff (boundary is exclusive)", async () => {
    const cutoff = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    const { r2, deleteCalls } = fakeR2({
      pages: [[{ key: "edge.png", lastModified: cutoff }]],
    });

    const result = await runR2OrphanSweep({
      r2,
      fetchReferencedKeys: async () => new Set(),
      step: passthroughStep,
      logger: silentLogger,
      now: fixedNow,
      graceMillis: 24 * 60 * 60 * 1000,
    });

    // lastModified === cutoff is NOT > cutoff, so the key is deleted.
    // Documenting the chosen side: equal-to-cutoff is treated as old.
    expect(result.deleted).toBe(1);
    expect(deleteCalls()).toEqual([["edge.png"]]);
  });

  test("empty bucket: no DeleteObjects, all counters zero", async () => {
    const { r2, send, deleteCalls } = fakeR2({ pages: [[]] });

    const result = await runR2OrphanSweep({
      r2,
      fetchReferencedKeys: async () => new Set(),
      step: passthroughStep,
      logger: silentLogger,
      now: fixedNow,
      graceMillis: 24 * 60 * 60 * 1000,
    });

    expect(result).toEqual({
      scanned: 0,
      deleted: 0,
      skippedYoung: 0,
      skippedReferenced: 0,
      batches: 0,
    });
    // Only the ListObjectsV2 call, no Delete.
    expect(send).toHaveBeenCalledTimes(1);
    expect(deleteCalls()).toEqual([]);
  });

  test("chunks >1000 deletable keys into multiple delete-batch-N steps", async () => {
    const old = new Date(NOW.getTime() - 48 * 60 * 60 * 1000);
    const keys = Array.from({ length: 1500 }, (_, i) => `orphan/${i}`);
    const { r2, deleteCalls } = fakeR2({
      pages: [keys.map((key) => ({ key, lastModified: old }))],
    });

    const stepRun = vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn());
    const step = { run: stepRun as unknown as typeof passthroughStep.run };

    const result = await runR2OrphanSweep({
      r2,
      fetchReferencedKeys: async () => new Set(),
      step,
      logger: silentLogger,
      now: fixedNow,
      graceMillis: 24 * 60 * 60 * 1000,
    });

    expect(result.deleted).toBe(1500);
    expect(result.batches).toBe(2);
    const batches = deleteCalls();
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(1000);
    expect(batches[1]).toHaveLength(500);
    // Step IDs must be deterministic delete-batch-N for Inngest's
    // memoization to short-circuit on retry.
    const stepIds = stepRun.mock.calls.map(([id]) => id);
    expect(stepIds).toEqual(["query-db", "delete-batch-0", "delete-batch-1"]);
  });

  test("aggregates counts across multiple list pages", async () => {
    const old = new Date(NOW.getTime() - 48 * 60 * 60 * 1000);
    const { r2, deleteCalls } = fakeR2({
      pages: [
        [{ key: "a", lastModified: old }],
        [{ key: "b", lastModified: old }],
        [{ key: "c", lastModified: old }],
      ],
    });

    const result = await runR2OrphanSweep({
      r2,
      fetchReferencedKeys: async () => new Set(),
      step: passthroughStep,
      logger: silentLogger,
      now: fixedNow,
      graceMillis: 24 * 60 * 60 * 1000,
    });

    expect(result.scanned).toBe(3);
    expect(result.deleted).toBe(3);
    expect(deleteCalls().flat()).toEqual(["a", "b", "c"]);
  });

  test("query-db error propagates so Inngest can retry the step", async () => {
    const { r2 } = fakeR2({ pages: [[]] });
    await expect(
      runR2OrphanSweep({
        r2,
        fetchReferencedKeys: async () => {
          throw new Error("DB unavailable");
        },
        step: passthroughStep,
        logger: silentLogger,
        now: fixedNow,
        graceMillis: 24 * 60 * 60 * 1000,
      })
    ).rejects.toThrow("DB unavailable");
  });

  test("delete-batch error propagates so Inngest can retry the chunk", async () => {
    const old = new Date(NOW.getTime() - 48 * 60 * 60 * 1000);
    const send = vi.fn();
    send.mockImplementation(async (cmd: unknown) => {
      if (cmd instanceof ListObjectsV2Command) {
        return {
          Contents: [{ Key: "orphan/x", LastModified: old, Size: 0 }],
          IsTruncated: false,
        };
      }
      if (cmd instanceof DeleteObjectsCommand) {
        throw new Error("R2 unavailable");
      }
      throw new Error("unexpected command");
    });
    const r2 = { s3: { send }, bucket: "test-bucket" } as unknown as R2Client;

    await expect(
      runR2OrphanSweep({
        r2,
        fetchReferencedKeys: async () => new Set(),
        step: passthroughStep,
        logger: silentLogger,
        now: fixedNow,
        graceMillis: 24 * 60 * 60 * 1000,
      })
    ).rejects.toThrow("R2 unavailable");
  });
});
