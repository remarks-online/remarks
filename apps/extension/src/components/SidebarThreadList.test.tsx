import { sidebarStore } from "@/lib/sidebar-store";
import type { AnnotationResponse } from "@remarks/shared";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mockUseInfiniteQuery = vi.fn();
const mockUseInfiniteQueryUser = vi.fn();
const mockUseCurrentUrl = vi.fn(() => "https://acme.com/page");

vi.mock("@/lib/trpc", () => ({
  trpc: {
    annotations: {
      list: {
        useInfiniteQuery: (...args: unknown[]) => mockUseInfiniteQuery(...args),
      },
      listForUser: {
        useInfiniteQuery: (...args: unknown[]) => mockUseInfiniteQueryUser(...args),
      },
    },
  },
}));

vi.mock("@/lib/use-current-url", () => ({
  useCurrentUrl: () => mockUseCurrentUrl(),
}));

const { SidebarThreadList } = await import("./SidebarThreadList");

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const BRANCH = "main";

function makeAnnotation(overrides: Partial<AnnotationResponse> = {}): AnnotationResponse {
  return {
    id: overrides.id ?? "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    projectId: PROJECT_ID,
    branchId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    branchName: "main",
    status: "to_do",
    targetType: "element",
    url: "https://acme.com/page",
    targetSelector: "#hero",
    targetCoords: null,
    viewport: { width: 1920, height: 1080, dpr: 2 },
    commentText: "This button should be green.",
    author: {
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      name: "Alice Dev",
      email: "alice@acme.com",
      avatarUrl: null,
    },
    assets: [],
    createdAt: "2026-04-20T10:00:00.000Z",
    updatedAt: "2026-04-20T10:00:00.000Z",
    ...overrides,
  };
}

function infiniteResult(opts: {
  items?: AnnotationResponse[];
  nextCursor?: string | null;
  isPending?: boolean;
  isError?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => void;
  refetch?: () => void;
}) {
  return {
    isPending: opts.isPending ?? false,
    isError: opts.isError ?? false,
    error: opts.isError ? new Error("network down") : null,
    data: {
      pages: [{ items: opts.items ?? [], nextCursor: opts.nextCursor ?? null }],
      pageParams: [undefined],
    },
    hasNextPage: (opts.nextCursor ?? null) !== null,
    isFetchingNextPage: opts.isFetchingNextPage ?? false,
    fetchNextPage: opts.fetchNextPage ?? vi.fn(),
    refetch: opts.refetch ?? vi.fn(),
  };
}

describe("SidebarThreadList", () => {
  beforeEach(() => {
    sidebarStore.getState().reset();
    mockUseInfiniteQuery.mockReset();
    mockUseInfiniteQueryUser.mockReset();
    // Default the personal-mode query to a stable empty result so tests that
    // only stub the project-mode query don't hit "undefined.useInfiniteQuery".
    mockUseInfiniteQueryUser.mockReturnValue(infiniteResult({ items: [] }));
    mockUseCurrentUrl.mockReset();
    mockUseCurrentUrl.mockReturnValue("https://acme.com/page");
  });

  afterEach(() => {
    cleanup();
  });

  test("renders skeleton while pending", () => {
    mockUseInfiniteQuery.mockReturnValue(infiniteResult({ isPending: true }));
    render(<SidebarThreadList projectId={PROJECT_ID} branch={BRANCH} />);
    expect(screen.getByLabelText("Loading annotations")).toBeTruthy();
  });

  test("renders empty state when no items and no status filter", () => {
    mockUseInfiniteQuery.mockReturnValue(infiniteResult({ items: [] }));
    render(<SidebarThreadList projectId={PROJECT_ID} branch={BRANCH} />);
    expect(screen.getByText("No annotations on this page")).toBeTruthy();
  });

  test("renders filtered empty state when status filter is active", () => {
    sidebarStore.getState().setStatusFilter("done");
    mockUseInfiniteQuery.mockReturnValue(infiniteResult({ items: [] }));
    render(<SidebarThreadList projectId={PROJECT_ID} branch={BRANCH} />);
    expect(screen.getByText("No matching annotations")).toBeTruthy();
  });

  test("renders an item for each annotation", () => {
    mockUseInfiniteQuery.mockReturnValue(
      infiniteResult({
        items: [
          makeAnnotation({ id: "11111111-aaaa-aaaa-aaaa-aaaaaaaaaaa1", commentText: "First" }),
          makeAnnotation({ id: "11111111-aaaa-aaaa-aaaa-aaaaaaaaaaa2", commentText: "Second" }),
        ],
      })
    );
    render(<SidebarThreadList projectId={PROJECT_ID} branch={BRANCH} />);
    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.getByText("Second")).toBeTruthy();
  });

  test("passes status filter into the query input when a status is selected", () => {
    sidebarStore.getState().setStatusFilter("to_do");
    mockUseInfiniteQuery.mockReturnValue(infiniteResult({ items: [] }));
    render(<SidebarThreadList projectId={PROJECT_ID} branch={BRANCH} />);

    expect(mockUseInfiniteQuery).toHaveBeenCalled();
    const [input] = mockUseInfiniteQuery.mock.calls[0] as [Record<string, unknown>];
    expect(input).toMatchObject({
      projectId: PROJECT_ID,
      branch: BRANCH,
      url: "https://acme.com/page",
      status: "to_do",
      limit: 50,
    });
  });

  test("omits status from the query input when filter is 'all'", () => {
    sidebarStore.getState().setStatusFilter("all");
    mockUseInfiniteQuery.mockReturnValue(infiniteResult({ items: [] }));
    render(<SidebarThreadList projectId={PROJECT_ID} branch={BRANCH} />);

    const [input] = mockUseInfiniteQuery.mock.calls[0] as [Record<string, unknown>];
    expect(input.status).toBeUndefined();
  });

  test("re-queries with new url when useCurrentUrl returns a new value", () => {
    mockUseInfiniteQuery.mockReturnValue(infiniteResult({ items: [] }));
    const { rerender } = render(<SidebarThreadList projectId={PROJECT_ID} branch={BRANCH} />);

    const [firstInput] = mockUseInfiniteQuery.mock.calls[0] as [Record<string, unknown>];
    expect(firstInput.url).toBe("https://acme.com/page");

    mockUseCurrentUrl.mockReturnValue("https://acme.com/checkout");
    rerender(<SidebarThreadList projectId={PROJECT_ID} branch={BRANCH} />);

    const lastCall = mockUseInfiniteQuery.mock.calls.at(-1) as [Record<string, unknown>];
    expect(lastCall[0].url).toBe("https://acme.com/checkout");
  });

  test("renders 'Load more' button when nextCursor is set and calls fetchNextPage on click", () => {
    const fetchNextPage = vi.fn();
    mockUseInfiniteQuery.mockReturnValue(
      infiniteResult({
        items: [makeAnnotation({ id: "11111111-aaaa-aaaa-aaaa-aaaaaaaaaaa1" })],
        nextCursor: "abc",
        fetchNextPage,
      })
    );
    render(<SidebarThreadList projectId={PROJECT_ID} branch={BRANCH} />);

    const button = screen.getByRole("button", { name: "Load more" });
    act(() => {
      fireEvent.click(button);
    });
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  test("renders error state with retry that calls refetch", () => {
    const refetch = vi.fn();
    mockUseInfiniteQuery.mockReturnValue(infiniteResult({ isError: true, refetch }));
    render(<SidebarThreadList projectId={PROJECT_ID} branch={BRANCH} />);

    const retry = screen.getByRole("button", { name: "Retry" });
    act(() => {
      fireEvent.click(retry);
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
