import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useCurrentUrl } from "./use-current-url";

describe("useCurrentUrl", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState({}, "", "/initial");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("returns the current href on mount", () => {
    const { result } = renderHook(() => useCurrentUrl());
    expect(result.current).toBe(window.location.href);
  });

  test("updates on popstate", () => {
    const { result } = renderHook(() => useCurrentUrl());
    const initial = result.current;

    act(() => {
      window.history.pushState({}, "", "/next");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(result.current).not.toBe(initial);
    expect(result.current).toBe(window.location.href);
  });

  test("polling picks up history.pushState within one tick", () => {
    const { result } = renderHook(() => useCurrentUrl());
    const initial = result.current;

    // pushState alone fires no event. The hook's interval should detect it.
    act(() => {
      window.history.pushState({}, "", "/spa-route");
    });
    expect(result.current).toBe(initial);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current).toBe(window.location.href);
    expect(result.current).not.toBe(initial);
  });

  test("polling does not re-render when href is unchanged", () => {
    let renderCount = 0;
    renderHook(() => {
      renderCount += 1;
      return useCurrentUrl();
    });
    const after = renderCount;

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(renderCount).toBe(after);
  });

  test("cleans up listener and interval on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useCurrentUrl());
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("popstate", expect.any(Function));
  });
});
