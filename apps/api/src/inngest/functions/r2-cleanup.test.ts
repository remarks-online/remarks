import { describe, expect, test, vi } from "vitest";
import type { R2Client } from "../../lib/r2.js";
import { runR2Cleanup } from "./r2-cleanup.js";

// Stub step.run: just executes the callback synchronously so we can observe
// whatever side effect the inner closure performs. Mirrors what Inngest does
// on a fresh attempt.
const passthroughStep = {
  async run<T>(_id: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  },
};

const silentLogger = { info: vi.fn() };

describe("runR2Cleanup", () => {
  test("calls deleteObjects with the event's keys", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const r2 = { s3: { send }, bucket: "test-bucket" } as unknown as R2Client;

    const result = await runR2Cleanup(
      r2,
      { keys: ["a", "b", "c"], origin: "annotation:abc" },
      passthroughStep,
      silentLogger
    );

    expect(result).toEqual({ deleted: 3, origin: "annotation:abc" });
    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0]?.[0] as {
      input: { Bucket: string; Delete: { Objects: Array<{ Key: string }> } };
    };
    expect(cmd.input.Bucket).toBe("test-bucket");
    expect(cmd.input.Delete.Objects.map((o) => o.Key)).toEqual(["a", "b", "c"]);
  });

  test("propagates errors so Inngest can retry the step", async () => {
    const send = vi.fn().mockRejectedValue(new Error("R2 unavailable"));
    const r2 = { s3: { send }, bucket: "test-bucket" } as unknown as R2Client;

    await expect(
      runR2Cleanup(r2, { keys: ["a"], origin: "project:xyz" }, passthroughStep, silentLogger)
    ).rejects.toThrow("R2 unavailable");
  });
});
