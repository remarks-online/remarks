import { beforeEach, describe, expect, it } from "vitest";
import {
  HEIGHT_MAX,
  HEIGHT_MIN,
  type PersistedSidebarPrefs,
  WIDTH_MAX,
  WIDTH_MIN,
  clampHeight,
  clampWidth,
  sidebarStore,
} from "./sidebar-store";

beforeEach(() => {
  sidebarStore.getState().reset();
});

describe("clampWidth / clampHeight", () => {
  it("clamps below the minimum", () => {
    expect(clampWidth(10)).toBe(WIDTH_MIN);
    expect(clampHeight(0)).toBe(HEIGHT_MIN);
  });

  it("clamps above the maximum", () => {
    expect(clampWidth(9999)).toBe(WIDTH_MAX);
    expect(clampHeight(9999)).toBe(HEIGHT_MAX);
  });

  it("passes through values in range", () => {
    expect(clampWidth(400)).toBe(400);
    expect(clampHeight(400)).toBe(400);
  });

  it("rounds fractional input to the nearest int", () => {
    expect(clampWidth(400.6)).toBe(401);
    expect(clampHeight(399.4)).toBe(399);
  });
});

describe("sidebarStore actions", () => {
  it("setDock updates the dock", () => {
    sidebarStore.getState().setDock("left");
    expect(sidebarStore.getState().dock).toBe("left");
  });

  it("setWidth clamps to the allowed range", () => {
    sidebarStore.getState().setWidth(10_000);
    expect(sidebarStore.getState().width).toBe(WIDTH_MAX);
    sidebarStore.getState().setWidth(50);
    expect(sidebarStore.getState().width).toBe(WIDTH_MIN);
  });

  it("setHeight clamps to the allowed range", () => {
    sidebarStore.getState().setHeight(10_000);
    expect(sidebarStore.getState().height).toBe(HEIGHT_MAX);
    sidebarStore.getState().setHeight(10);
    expect(sidebarStore.getState().height).toBe(HEIGHT_MIN);
  });

  it("setVisible, setTheme, setStatusFilter, setDraftComment update their slots", () => {
    const s = sidebarStore.getState();
    s.setVisible(false);
    expect(sidebarStore.getState().visible).toBe(false);
    s.setTheme("dark");
    expect(sidebarStore.getState().theme).toBe("dark");
    s.setStatusFilter("doing");
    expect(sidebarStore.getState().statusFilter).toBe("doing");
    s.setDraftComment("hello");
    expect(sidebarStore.getState().draftComment).toBe("hello");
  });

  it("setStatusFilter accepts the agent-set 'acknowledged' value", () => {
    sidebarStore.getState().setStatusFilter("acknowledged");
    expect(sidebarStore.getState().statusFilter).toBe("acknowledged");
  });

  it("setIntentFilter / setSeverityFilter update their slots", () => {
    const s = sidebarStore.getState();
    s.setIntentFilter("fix");
    expect(sidebarStore.getState().intentFilter).toBe("fix");
    s.setSeverityFilter("blocking");
    expect(sidebarStore.getState().severityFilter).toBe("blocking");
  });

  it("setDraftIntent / setDraftSeverity round-trip null", () => {
    const s = sidebarStore.getState();
    s.setDraftIntent("question");
    s.setDraftSeverity("important");
    expect(sidebarStore.getState().draftIntent).toBe("question");
    expect(sidebarStore.getState().draftSeverity).toBe("important");
    s.setDraftIntent(null);
    s.setDraftSeverity(null);
    expect(sidebarStore.getState().draftIntent).toBeNull();
    expect(sidebarStore.getState().draftSeverity).toBeNull();
  });

  it("reset clears draft intent / severity / filters back to defaults", () => {
    const s = sidebarStore.getState();
    s.setDraftIntent("fix");
    s.setDraftSeverity("blocking");
    s.setIntentFilter("change");
    s.setSeverityFilter("important");
    sidebarStore.getState().reset();
    const after = sidebarStore.getState();
    expect(after.draftIntent).toBeNull();
    expect(after.draftSeverity).toBeNull();
    expect(after.intentFilter).toBe("all");
    expect(after.severityFilter).toBe("all");
  });

  it("toggleVisible flips visibility", () => {
    sidebarStore.getState().setVisible(true);
    sidebarStore.getState().toggleVisible();
    expect(sidebarStore.getState().visible).toBe(false);
    sidebarStore.getState().toggleVisible();
    expect(sidebarStore.getState().visible).toBe(true);
  });

  it("hydrate merges a persisted snapshot without overwriting in-memory-only fields", () => {
    sidebarStore.getState().setDraftComment("in progress");
    sidebarStore.getState().hydrate({
      visible: false,
      dock: "bottom",
      width: 450,
      height: 300,
      theme: "dark",
      showHoverStyles: true,
    });
    const state = sidebarStore.getState();
    expect(state.visible).toBe(false);
    expect(state.dock).toBe("bottom");
    expect(state.width).toBe(450);
    expect(state.height).toBe(300);
    expect(state.theme).toBe("dark");
    expect(state.showHoverStyles).toBe(true);
    // in-memory-only fields untouched by hydrate
    expect(state.draftComment).toBe("in progress");
    expect(state.statusFilter).toBe("all");
  });

  it("hydrate clamps persisted size values", () => {
    sidebarStore.getState().hydrate({
      visible: true,
      dock: "right",
      width: 9999,
      height: 50,
      theme: "auto",
      showHoverStyles: false,
    });
    expect(sidebarStore.getState().width).toBe(WIDTH_MAX);
    expect(sidebarStore.getState().height).toBe(HEIGHT_MIN);
  });

  it("hydrate falls back to the default when showHoverStyles is missing from persisted snapshot", () => {
    // Older clients persisted snapshots without this field; loadSidebarPrefs
    // type-asserts the result, so the runtime value can be undefined.
    const legacy = {
      visible: true,
      dock: "right",
      width: 360,
      height: 280,
      theme: "auto",
    } as unknown as PersistedSidebarPrefs;
    sidebarStore.getState().hydrate(legacy);
    expect(sidebarStore.getState().showHoverStyles).toBe(false);
  });

  it("setShowHoverStyles toggles the pref", () => {
    expect(sidebarStore.getState().showHoverStyles).toBe(false);
    sidebarStore.getState().setShowHoverStyles(true);
    expect(sidebarStore.getState().showHoverStyles).toBe(true);
    sidebarStore.getState().setShowHoverStyles(false);
    expect(sidebarStore.getState().showHoverStyles).toBe(false);
  });
});
