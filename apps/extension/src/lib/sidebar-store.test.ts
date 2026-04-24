import { beforeEach, describe, expect, it } from "vitest";
import {
  DOCK_CYCLE,
  HEIGHT_MAX,
  HEIGHT_MIN,
  WIDTH_MAX,
  WIDTH_MIN,
  clampHeight,
  clampWidth,
  nextDock,
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

describe("nextDock", () => {
  it("cycles right → left → bottom → right", () => {
    expect(nextDock("right")).toBe(DOCK_CYCLE[1]);
    expect(nextDock("left")).toBe(DOCK_CYCLE[2]);
    expect(nextDock("bottom")).toBe(DOCK_CYCLE[0]);
  });
});

describe("sidebarStore actions", () => {
  it("setDock updates the dock", () => {
    sidebarStore.getState().setDock("left");
    expect(sidebarStore.getState().dock).toBe("left");
  });

  it("cycleDock advances through the cycle", () => {
    sidebarStore.getState().setDock("right");
    sidebarStore.getState().cycleDock();
    expect(sidebarStore.getState().dock).toBe("left");
    sidebarStore.getState().cycleDock();
    expect(sidebarStore.getState().dock).toBe("bottom");
    sidebarStore.getState().cycleDock();
    expect(sidebarStore.getState().dock).toBe("right");
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

  it("setCompact, setVisible, setTheme, setStatusFilter, setDraftComment update their slots", () => {
    const s = sidebarStore.getState();
    s.setCompact(true);
    expect(sidebarStore.getState().compact).toBe(true);
    s.setVisible(false);
    expect(sidebarStore.getState().visible).toBe(false);
    s.setTheme("dark");
    expect(sidebarStore.getState().theme).toBe("dark");
    s.setStatusFilter("doing");
    expect(sidebarStore.getState().statusFilter).toBe("doing");
    s.setDraftComment("hello");
    expect(sidebarStore.getState().draftComment).toBe("hello");
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
      compact: true,
      width: 450,
      height: 300,
      theme: "dark",
    });
    const state = sidebarStore.getState();
    expect(state.visible).toBe(false);
    expect(state.dock).toBe("bottom");
    expect(state.compact).toBe(true);
    expect(state.width).toBe(450);
    expect(state.height).toBe(300);
    expect(state.theme).toBe("dark");
    // in-memory-only fields untouched by hydrate
    expect(state.draftComment).toBe("in progress");
    expect(state.statusFilter).toBe("all");
  });

  it("hydrate clamps persisted size values", () => {
    sidebarStore.getState().hydrate({
      visible: true,
      dock: "right",
      compact: false,
      width: 9999,
      height: 50,
      theme: "auto",
    });
    expect(sidebarStore.getState().width).toBe(WIDTH_MAX);
    expect(sidebarStore.getState().height).toBe(HEIGHT_MIN);
  });
});
