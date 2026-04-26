import { getProjectContextOutputSchema } from "@remarks/mcp-schema";
import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../types/auth.js";
import { getProjectContextHandler } from "./get-project-context.js";
import type { ApiClient } from "./types.js";

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const STUB_AUTH: AuthContext = {
  tokenId: "11111111-1111-4111-8111-111111111111",
  projectId: PROJECT_ID,
  scopes: ["tasks:read", "project:read"],
};

function makeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    fetchWhoami: vi.fn(),
    fetchProjectContext: vi.fn(),
    fetchListAnnotations: vi.fn(),
    fetchAnnotation: vi.fn(),
    ...overrides,
  } as ApiClient;
}

describe("getProjectContextHandler", () => {
  it("returns project metadata + active branches with design_tokens null", async () => {
    const fetchProjectContext = vi.fn().mockResolvedValue({
      project: {
        id: PROJECT_ID,
        name: "Acme",
        slug: "acme",
        primaryBranch: "main",
        gitRepoUrl: null,
      },
      activeBranches: [
        {
          name: "feat/checkout",
          openTaskCount: 3,
          lastActivity: "2026-04-26T10:00:00.000Z",
        },
        {
          name: "main",
          openTaskCount: 1,
          lastActivity: "2026-04-25T22:00:00.000Z",
        },
      ],
    });
    const api = makeApi({ fetchProjectContext });

    const result = await getProjectContextHandler(
      { project_id: PROJECT_ID },
      { auth: STUB_AUTH, api, requestId: "req_test" }
    );

    expect(fetchProjectContext).toHaveBeenCalledWith(PROJECT_ID);
    const parsed = getProjectContextOutputSchema.parse(result.structuredContent);
    expect(parsed.project).toEqual({
      id: PROJECT_ID,
      name: "Acme",
      slug: "acme",
      primary_branch: "main",
      git_repo_url: null,
    });
    expect(parsed.active_branches).toEqual([
      {
        name: "feat/checkout",
        open_task_count: 3,
        last_activity: "2026-04-26T10:00:00.000Z",
      },
      {
        name: "main",
        open_task_count: 1,
        last_activity: "2026-04-25T22:00:00.000Z",
      },
    ]);
    expect(parsed.design_tokens).toBeNull();
  });

  it("rejects cross-project access with NOT_FOUND, never calls api", async () => {
    const fetchProjectContext = vi.fn();
    const api = makeApi({ fetchProjectContext });
    await expect(
      getProjectContextHandler(
        { project_id: "99999999-9999-4999-8999-999999999999" },
        { auth: STUB_AUTH, api, requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fetchProjectContext).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when api returns null", async () => {
    const api = makeApi({ fetchProjectContext: vi.fn().mockResolvedValue(null) });
    await expect(
      getProjectContextHandler(
        { project_id: PROJECT_ID },
        { auth: STUB_AUTH, api, requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
