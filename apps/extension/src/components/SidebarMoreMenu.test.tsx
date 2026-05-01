import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readExtensionVersion } from "./SidebarMoreMenu";

describe("readExtensionVersion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("returns the manifest version when chrome.runtime.getManifest is available", () => {
    vi.stubGlobal("chrome", {
      runtime: {
        id: "test-extension",
        getManifest: () => ({ version: "1.2.3" }),
      },
    });
    expect(readExtensionVersion()).toBe("1.2.3");
  });

  test("falls back to a placeholder when the runtime API is missing", () => {
    vi.stubGlobal("chrome", { runtime: { id: "test-extension" } });
    expect(readExtensionVersion()).toBe("?.?.?");
  });

  test("falls back to a placeholder when getManifest throws", () => {
    vi.stubGlobal("chrome", {
      runtime: {
        id: "test-extension",
        getManifest: () => {
          throw new Error("manifest unavailable");
        },
      },
    });
    expect(readExtensionVersion()).toBe("?.?.?");
  });
});
