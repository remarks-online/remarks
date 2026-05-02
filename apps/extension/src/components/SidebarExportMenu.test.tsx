import { sidebarStore } from "@/lib/sidebar-store";
import type { AnnotationResponse } from "@remarks/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mockProjectQuery = vi.fn();
const mockUserQuery = vi.fn();

vi.mock("@/lib/trpc", () => ({
  trpc: {
    annotations: {
      list: {
        useInfiniteQuery: (...args: unknown[]) => mockProjectQuery(...args),
      },
      listForUser: {
        useInfiniteQuery: (...args: unknown[]) => mockUserQuery(...args),
      },
    },
  },
}));

vi.mock("@/lib/use-current-url", () => ({
  useCurrentUrl: () => "https://acme.com/page",
}));

vi.mock("@/lib/shadow-root-context", () => ({
  useShadowRootPortalContainer: () => null,
}));

vi.mock("@/env", () => ({
  env: { WXT_DASHBOARD_URL: "https://remarks.online" },
}));

const { SidebarExportMenu } = await import("./SidebarExportMenu");

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const BRANCH = "main";

function makeAnnotation(overrides: Partial<AnnotationResponse> = {}): AnnotationResponse {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    projectId: PROJECT_ID,
    projectSlug: "acme",
    branchId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    branchName: "main",
    status: "to_do",
    targetType: "element",
    intent: null,
    severity: null,
    url: "https://acme.com/page",
    targetSelector: "#hero",
    targetCoords: null,
    viewport: { width: 1920, height: 1080, dpr: 2 },
    domContext: null,
    frameworkHint: null,
    commentText: "Sample annotation",
    author: {
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      name: "Alice",
      email: "alice@acme.com",
      avatarUrl: null,
    },
    assets: [],
    createdAt: "2026-04-20T10:00:00.000Z",
    updatedAt: "2026-04-20T10:00:00.000Z",
    ...overrides,
  };
}

function infiniteResult(items: AnnotationResponse[]) {
  return {
    isPending: false,
    isError: false,
    error: null,
    data: { pages: [{ items, nextCursor: null }], pageParams: [undefined] },
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  };
}

describe("SidebarExportMenu", () => {
  beforeEach(() => {
    sidebarStore.getState().reset();
    mockProjectQuery.mockReset();
    mockUserQuery.mockReset();
    mockProjectQuery.mockReturnValue(infiniteResult([]));
    mockUserQuery.mockReturnValue(infiniteResult([]));
  });

  afterEach(() => {
    cleanup();
  });

  test("trigger is disabled when there are no items", () => {
    render(<SidebarExportMenu projectId={PROJECT_ID} branch={BRANCH} />);
    const trigger = screen.getByRole("button", { name: "Export annotations as markdown" });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
  });

  test("trigger is enabled when items are present", () => {
    mockProjectQuery.mockReturnValue(infiniteResult([makeAnnotation()]));
    render(<SidebarExportMenu projectId={PROJECT_ID} branch={BRANCH} />);
    const trigger = screen.getByRole("button", { name: "Export annotations as markdown" });
    expect((trigger as HTMLButtonElement).disabled).toBe(false);
  });

  test("project mode runs the project list query, not the personal query", () => {
    mockProjectQuery.mockReturnValue(infiniteResult([makeAnnotation()]));
    render(<SidebarExportMenu projectId={PROJECT_ID} branch={BRANCH} />);

    expect(mockProjectQuery).toHaveBeenCalled();
    const [input, options] = mockProjectQuery.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(input).toMatchObject({
      projectId: PROJECT_ID,
      branch: BRANCH,
      url: "https://acme.com/page",
    });
    expect(options.enabled).toBe(true);

    // The user query is still mounted (React needs the hook order stable) but
    // is gated off so it doesn't fire a second request.
    const [, userOptions] = mockUserQuery.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(userOptions.enabled).toBe(false);
  });

  test("personal mode runs the listForUser query instead", () => {
    mockUserQuery.mockReturnValue(infiniteResult([makeAnnotation()]));
    render(<SidebarExportMenu projectId={null} branch={null} />);

    const [, projectOptions] = mockProjectQuery.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(projectOptions.enabled).toBe(false);

    const [input, userOptions] = mockUserQuery.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(userOptions.enabled).toBe(true);
    expect(input).toMatchObject({ url: "https://acme.com/page", scope: "all" });
  });

  test("forwards active sidebar filters to the query input", () => {
    sidebarStore.getState().setStatusFilter("to_do");
    sidebarStore.getState().setIntentFilter("fix");
    sidebarStore.getState().setSeverityFilter("blocking");
    mockProjectQuery.mockReturnValue(infiniteResult([]));

    render(<SidebarExportMenu projectId={PROJECT_ID} branch={BRANCH} />);

    const [input] = mockProjectQuery.mock.calls[0] as [Record<string, unknown>];
    expect(input).toMatchObject({ status: "to_do", intent: "fix", severity: "blocking" });
  });
});
