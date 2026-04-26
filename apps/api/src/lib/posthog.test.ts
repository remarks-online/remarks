import { describe, expect, it, vi } from "vitest";

// Mock posthog-node so importing capture/shutdownAnalytics doesn't open a
// network client. We assert the no-op path (key unset) and that the configured
// path passes through to PostHog.capture(). Resetting modules between cases
// gives each test a clean env.
async function loadHelper(envOverrides: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) {
      Reflect.deleteProperty(process.env, k);
    } else {
      process.env[k] = v;
    }
  }
  const captureSpy = vi.fn();
  const shutdownSpy = vi.fn().mockResolvedValue(undefined);
  vi.doMock("posthog-node", () => ({
    PostHog: vi.fn().mockImplementation(() => ({
      capture: captureSpy,
      shutdown: shutdownSpy,
    })),
  }));
  const mod = await import("./posthog.js");
  return { mod, captureSpy, shutdownSpy };
}

describe("posthog server helper", () => {
  it("no-ops when POSTHOG_PROJECT_API_KEY is unset", async () => {
    const { mod, captureSpy } = await loadHelper({
      POSTHOG_PROJECT_API_KEY: undefined,
      // Required env so apps/api/src/env.ts parses cleanly.
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
      CLERK_WEBHOOK_SECRET: "whsec_test",
      CLERK_SECRET_KEY: "sk_test_x",
      R2_ACCOUNT_ID: "acc",
      R2_ACCESS_KEY_ID: "k",
      R2_SECRET_ACCESS_KEY: "s",
      R2_BUCKET_SCREENSHOTS: "b",
    });
    mod.capture({ event: "org_created", distinctId: "u_1" });
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("forwards to PostHog.capture when key is set", async () => {
    const { mod, captureSpy } = await loadHelper({
      POSTHOG_PROJECT_API_KEY: "phc_test",
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
      CLERK_WEBHOOK_SECRET: "whsec_test",
      CLERK_SECRET_KEY: "sk_test_x",
      R2_ACCOUNT_ID: "acc",
      R2_ACCESS_KEY_ID: "k",
      R2_SECRET_ACCESS_KEY: "s",
      R2_BUCKET_SCREENSHOTS: "b",
    });
    mod.capture({
      event: "annotation_status_changed",
      distinctId: "u_1",
      properties: { from: "to_do", to: "doing" },
    });
    expect(captureSpy).toHaveBeenCalledTimes(1);
    expect(captureSpy).toHaveBeenCalledWith({
      distinctId: "u_1",
      event: "annotation_status_changed",
      properties: { from: "to_do", to: "doing" },
    });
  });

  it("swallows errors from the underlying client", async () => {
    const { mod, captureSpy } = await loadHelper({
      POSTHOG_PROJECT_API_KEY: "phc_test",
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
      CLERK_WEBHOOK_SECRET: "whsec_test",
      CLERK_SECRET_KEY: "sk_test_x",
      R2_ACCOUNT_ID: "acc",
      R2_ACCESS_KEY_ID: "k",
      R2_SECRET_ACCESS_KEY: "s",
      R2_BUCKET_SCREENSHOTS: "b",
    });
    captureSpy.mockImplementation(() => {
      throw new Error("posthog down");
    });
    expect(() => mod.capture({ event: "org_created", distinctId: "u_2" })).not.toThrow();
  });

  it("shutdownAnalytics is idempotent and tolerates an uninitialized client", async () => {
    const { mod, shutdownSpy } = await loadHelper({
      POSTHOG_PROJECT_API_KEY: undefined,
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
      CLERK_WEBHOOK_SECRET: "whsec_test",
      CLERK_SECRET_KEY: "sk_test_x",
      R2_ACCOUNT_ID: "acc",
      R2_ACCESS_KEY_ID: "k",
      R2_SECRET_ACCESS_KEY: "s",
      R2_BUCKET_SCREENSHOTS: "b",
    });
    await mod.shutdownAnalytics();
    await mod.shutdownAnalytics();
    expect(shutdownSpy).not.toHaveBeenCalled();
  });
});
