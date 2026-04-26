import { whoamiOutputSchema } from "@remarks/mcp-schema";
import { describe, expect, it, vi } from "vitest";
import { McpToolError } from "../lib/mcp-error.js";
import type { AuthContext } from "../types/auth.js";
import type { ApiClient } from "./types.js";
import { whoamiHandler } from "./whoami.js";

const STUB_AUTH: AuthContext = {
  tokenId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  scopes: ["tasks:read", "tasks:write", "project:read"],
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

describe("whoamiHandler", () => {
  it("returns project + token + version metadata on success", async () => {
    const fetchWhoami = vi.fn().mockResolvedValue({
      token: { id: STUB_AUTH.tokenId, name: "Cursor on laptop", scopes: STUB_AUTH.scopes },
      project: { id: STUB_AUTH.projectId, name: "Acme", slug: "acme" },
    });
    const api = makeApi({ fetchWhoami });

    const result = await whoamiHandler({}, { auth: STUB_AUTH, api, requestId: "req_test" });

    expect(fetchWhoami).toHaveBeenCalledWith(STUB_AUTH.tokenId);
    const parsed = whoamiOutputSchema.parse(result.structuredContent);
    expect(parsed.project).toEqual({
      id: STUB_AUTH.projectId,
      name: "Acme",
      slug: "acme",
    });
    expect(parsed.token_name).toBe("Cursor on laptop");
    expect(parsed.token_scopes).toEqual(STUB_AUTH.scopes);
    expect(parsed.server_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(parsed.skill_version).toBeTypeOf("string");
  });

  it("throws NOT_FOUND when api returns null", async () => {
    const api = makeApi({ fetchWhoami: vi.fn().mockResolvedValue(null) });
    await expect(
      whoamiHandler({}, { auth: STUB_AUTH, api, requestId: "req_test" })
    ).rejects.toBeInstanceOf(McpToolError);
  });
});
