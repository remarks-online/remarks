import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FREEZE_STYLE_ID,
  applyFreeze,
  initAnimationFreezeController,
  releaseFreeze,
} from "./animation-freeze";
import { sidebarStore } from "./sidebar-store";

beforeEach(() => {
  sidebarStore.getState().reset();
  document.getElementById(FREEZE_STYLE_ID)?.remove();
});

afterEach(() => {
  document.getElementById(FREEZE_STYLE_ID)?.remove();
});

describe("applyFreeze / releaseFreeze", () => {
  it("injects a style element with the freeze CSS", () => {
    applyFreeze();
    const style = document.getElementById(FREEZE_STYLE_ID) as HTMLStyleElement | null;
    expect(style).not.toBeNull();
    expect(style?.tagName).toBe("STYLE");
    // Pin both rules — a future "fix" that drops `transition: none` would let
    // mid-transition screenshots regress to fuzzy frames.
    expect(style?.textContent).toContain("animation-play-state: paused !important");
    expect(style?.textContent).toContain("transition: none !important");
    expect(style?.textContent).toContain("*, *::before, *::after");
  });

  it("is idempotent — second applyFreeze does not append a duplicate style", () => {
    applyFreeze();
    applyFreeze();
    expect(document.querySelectorAll(`#${FREEZE_STYLE_ID}`).length).toBe(1);
  });

  it("releaseFreeze removes the style element", () => {
    applyFreeze();
    expect(document.getElementById(FREEZE_STYLE_ID)).not.toBeNull();
    releaseFreeze();
    expect(document.getElementById(FREEZE_STYLE_ID)).toBeNull();
  });

  it("releaseFreeze is a no-op when nothing is frozen", () => {
    expect(() => {
      releaseFreeze();
      releaseFreeze();
    }).not.toThrow();
    expect(document.getElementById(FREEZE_STYLE_ID)).toBeNull();
  });

  it("guards Document.getAnimations when unavailable (jsdom path)", () => {
    // jsdom's Document doesn't implement getAnimations(); applyFreeze should
    // simply skip the JS-animation pause sweep instead of throwing.
    expect(typeof document.getAnimations).toBe("undefined");
    expect(() => applyFreeze()).not.toThrow();
  });

  it("pauses running Animations and resumes them on release when supported", () => {
    const pause = vi.fn();
    const play = vi.fn();
    const fakeAnimations: Animation[] = [
      { playState: "running", pause, play } as unknown as Animation,
      { playState: "finished", pause, play } as unknown as Animation,
    ];
    // jsdom doesn't ship Document.getAnimations, but lib.dom types it as a
    // non-optional method — direct property assignment of `undefined` trips
    // TS2322 in CI. defineProperty + Reflect.deleteProperty puts the method on
    // the instance for this test only and removes it cleanly so the "guards"
    // test above keeps exercising the undefined branch.
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: () => fakeAnimations,
    });
    try {
      applyFreeze();
      expect(pause).toHaveBeenCalledTimes(1);
      releaseFreeze();
      expect(play).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(document, "getAnimations");
    }
  });
});

describe("initAnimationFreezeController", () => {
  it("does not freeze on init when defaults are off", () => {
    const teardown = initAnimationFreezeController();
    try {
      expect(document.getElementById(FREEZE_STYLE_ID)).toBeNull();
    } finally {
      teardown();
    }
  });

  it("freezes when freezeAnimations flips on while sidebar is visible", () => {
    const teardown = initAnimationFreezeController();
    try {
      sidebarStore.getState().setFreezeAnimations(true);
      expect(document.getElementById(FREEZE_STYLE_ID)).not.toBeNull();
      sidebarStore.getState().setFreezeAnimations(false);
      expect(document.getElementById(FREEZE_STYLE_ID)).toBeNull();
    } finally {
      teardown();
    }
  });

  it("releases freeze when sidebar is hidden, reapplies on show", () => {
    const teardown = initAnimationFreezeController();
    try {
      sidebarStore.getState().setFreezeAnimations(true);
      expect(document.getElementById(FREEZE_STYLE_ID)).not.toBeNull();
      sidebarStore.getState().setVisible(false);
      expect(document.getElementById(FREEZE_STYLE_ID)).toBeNull();
      sidebarStore.getState().setVisible(true);
      expect(document.getElementById(FREEZE_STYLE_ID)).not.toBeNull();
    } finally {
      teardown();
    }
  });

  it("teardown removes the style and unsubscribes", () => {
    const teardown = initAnimationFreezeController();
    sidebarStore.getState().setFreezeAnimations(true);
    expect(document.getElementById(FREEZE_STYLE_ID)).not.toBeNull();
    teardown();
    expect(document.getElementById(FREEZE_STYLE_ID)).toBeNull();
    // After teardown the subscription should be detached — flipping the toggle
    // again must not re-inject the style.
    sidebarStore.getState().setFreezeAnimations(false);
    sidebarStore.getState().setFreezeAnimations(true);
    expect(document.getElementById(FREEZE_STYLE_ID)).toBeNull();
  });
});
