import { watchAnnotationsOutputSchema } from "@remarks/mcp-schema";
import type { AnnotationResponse } from "@remarks/shared";
import { describe, expect, it, vi } from "vitest";
import type { WatchAnnotationsPayload } from "../lib/api-client.js";
import type { IdempotencyCache } from "../lib/idempotency.js";
import type { AuthContext } from "../types/auth.js";
import type { ApiClient } from "./types.js";
import { watchAnnotationsHandler } from "./watch-annotations.js";

const CLERK_USER_ID = "user_2abc123";
const STUB_AUTH: AuthContext = {
  clerkUserId: CLERK_USER_ID,
  scopes: ["tasks:read", "tasks:write", "project:read"],
  oauthClientName: "Claude Code",
};

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ANNOTATION_ID = "22222222-2222-4222-8222-222222222222";
const ORG_ID = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-05-03T10:00:00.000Z";

function makeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    assertProjectAccess: vi.fn().mockResolvedValue(true),
    listAccessibleProjects: vi.fn().mockResolvedValue([]),
    assertOrgAccess: vi.fn().mockResolvedValue(true),
    listAccessibleOrgs: vi.fn().mockResolvedValue([]),
    fetchWhoami: vi.fn(),
    fetchProjectContext: vi.fn(),
    fetchListAnnotations: vi.fn(),
    fetchListPersonalAnnotations: vi.fn(),
    fetchListOrgAnnotations: vi.fn(),
    fetchListAllAnnotations: vi.fn(),
    fetchAnnotation: vi.fn(),
    updateAnnotationStatus: vi.fn(),
    addAnnotationComment: vi.fn(),
    fetchWatchAnnotations: vi.fn(),
    ...overrides,
  } as ApiClient;
}

function makeIdempotency(overrides: Partial<IdempotencyCache> = {}): IdempotencyCache {
  return {
    check: vi.fn().mockResolvedValue({ kind: "miss" }),
    store: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as IdempotencyCache;
}

function makeAnnotation(): AnnotationResponse & { frameworkHint: string | null } {
  return {
    id: ANNOTATION_ID,
    projectId: PROJECT_ID,
    projectSlug: "web-app",
    branchId: "44444444-4444-4444-8444-444444444444",
    branchName: "main",
    status: "to_do",
    targetType: "element",
    intent: "fix",
    severity: "blocking",
    url: "https://example.com",
    targetSelector: "button.primary",
    targetCoords: null,
    viewport: { width: 1280, height: 720, dpr: 2 },
    domContext: {
      tagName: "button",
      classes: ["primary"],
      textContent: null,
      computedStyles: null,
      ancestors: null,
      reactComponents: null,
    },
    frameworkHint: "react",
    commentText: "make this orange",
    author: {
      id: "55555555-5555-4555-8555-555555555555",
      name: "Reviewer",
      email: "reviewer@example.com",
      avatarUrl: null,
    },
    assets: [
      {
        id: "66666666-6666-4666-8666-666666666666",
        kind: "screenshot",
        url: "https://r2.example.com/presigned",
        contentType: "image/png",
      },
    ],
    groupId: null,
    groupSize: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makePayload(overrides: Partial<WatchAnnotationsPayload> = {}): WatchAnnotationsPayload {
  return {
    events: [
      {
        streamEvent: {
          id: `${NOW}:77777777-7777-4777-8777-777777777777`,
          type: "created",
          annotationId: ANNOTATION_ID,
          projectId: PROJECT_ID,
          authorId: "55555555-5555-4555-8555-555555555555",
          actorType: "user",
          actorId: "55555555-5555-4555-8555-555555555555",
          actorOauthClientId: null,
          payload: {},
          createdAt: NOW,
        },
        annotation: makeAnnotation(),
        autoAcknowledged: false,
      },
    ],
    nextCursor: `${NOW}:77777777-7777-4777-8777-777777777777`,
    idle: false,
    replayTruncated: false,
    moreAvailable: false,
    ...overrides,
  };
}

describe("watchAnnotationsHandler", () => {
  it("project mode: routes through requireProjectAccess + projects events to wire shape", async () => {
    const fetchWatchAnnotations = vi.fn().mockResolvedValue(makePayload());
    const assertProjectAccess = vi.fn().mockResolvedValue(true);
    const api = makeApi({ fetchWatchAnnotations, assertProjectAccess });

    const result = await watchAnnotationsHandler(
      { project_id: PROJECT_ID, wait_seconds: 5 },
      { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
    );

    expect(assertProjectAccess).toHaveBeenCalledWith(CLERK_USER_ID, PROJECT_ID);
    expect(fetchWatchAnnotations).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        clerkUserId: CLERK_USER_ID,
        oauthClientName: "Claude Code",
        waitSeconds: 5,
      })
    );
    const parsed = watchAnnotationsOutputSchema.parse(result.structuredContent);
    expect(parsed.events).toHaveLength(1);
    const ev = parsed.events[0];
    expect(ev?.annotation_id).toBe(ANNOTATION_ID);
    expect(ev?.annotation?.target.selector).toBe("button.primary");
    expect(ev?.annotation?.screenshot_url).toBe("https://r2.example.com/presigned");
    expect(ev?.annotation?.dom_context).toEqual({
      tag_name: "button",
      classes: ["primary"],
    });
  });

  it("org mode: routes through requireOrgAccess + sends userMode org", async () => {
    const fetchWatchAnnotations = vi.fn().mockResolvedValue(makePayload({ events: [] }));
    const assertOrgAccess = vi.fn().mockResolvedValue(true);
    const api = makeApi({ fetchWatchAnnotations, assertOrgAccess });

    await watchAnnotationsHandler(
      { org_id: ORG_ID },
      { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
    );

    expect(assertOrgAccess).toHaveBeenCalledWith(CLERK_USER_ID, ORG_ID);
    expect(fetchWatchAnnotations).toHaveBeenCalledWith(
      expect.objectContaining({
        userMode: { mode: "org", orgId: ORG_ID },
      })
    );
  });

  it("scope=personal: no auth side-trip; userMode personal", async () => {
    const fetchWatchAnnotations = vi.fn().mockResolvedValue(makePayload({ events: [] }));
    const assertOrgAccess = vi.fn();
    const assertProjectAccess = vi.fn();
    const api = makeApi({ fetchWatchAnnotations, assertOrgAccess, assertProjectAccess });

    await watchAnnotationsHandler(
      { scope: "personal" },
      { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
    );

    expect(assertOrgAccess).not.toHaveBeenCalled();
    expect(assertProjectAccess).not.toHaveBeenCalled();
    expect(fetchWatchAnnotations).toHaveBeenCalledWith(
      expect.objectContaining({ userMode: { mode: "personal" } })
    );
  });

  it("no scope marker defaults to all-mode", async () => {
    const fetchWatchAnnotations = vi.fn().mockResolvedValue(makePayload({ events: [] }));
    const api = makeApi({ fetchWatchAnnotations });

    await watchAnnotationsHandler(
      {},
      { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
    );

    expect(fetchWatchAnnotations).toHaveBeenCalledWith(
      expect.objectContaining({ userMode: { mode: "all" } })
    );
  });

  it("multiple scope markers → VALIDATION_ERROR", async () => {
    await expect(
      watchAnnotationsHandler(
        { project_id: PROJECT_ID, org_id: ORG_ID },
        {
          auth: STUB_AUTH,
          api: makeApi(),
          idempotency: makeIdempotency(),
          requestId: "req_test",
        }
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("branch filter without project_id → VALIDATION_ERROR", async () => {
    await expect(
      watchAnnotationsHandler(
        { branch: "main", scope: "all" },
        {
          auth: STUB_AUTH,
          api: makeApi(),
          idempotency: makeIdempotency(),
          requestId: "req_test",
        }
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("auto_acknowledge=true without tasks:write → FORBIDDEN", async () => {
    const auth: AuthContext = { ...STUB_AUTH, scopes: ["tasks:read", "project:read"] };
    await expect(
      watchAnnotationsHandler(
        { project_id: PROJECT_ID, auto_acknowledge: true },
        { auth, api: makeApi(), idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("filters pass through: intent / severity / status / event_types / branch", async () => {
    const fetchWatchAnnotations = vi.fn().mockResolvedValue(makePayload({ events: [] }));
    const api = makeApi({ fetchWatchAnnotations });

    await watchAnnotationsHandler(
      {
        project_id: PROJECT_ID,
        intent: ["fix", "change"],
        severity: ["blocking"],
        status: ["to_do"],
        event_types: ["created", "comment_added"],
        branch: "feat/buttons",
      },
      { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
    );

    expect(fetchWatchAnnotations).toHaveBeenCalledWith(
      expect.objectContaining({
        intents: ["fix", "change"],
        severities: ["blocking"],
        statuses: ["to_do"],
        eventTypes: ["created", "comment_added"],
        branch: "feat/buttons",
      })
    );
  });

  it("404 from API → NOT_FOUND", async () => {
    const fetchWatchAnnotations = vi.fn().mockResolvedValue(null);
    const api = makeApi({ fetchWatchAnnotations });
    await expect(
      watchAnnotationsHandler(
        { project_id: PROJECT_ID },
        { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("idle: true is preserved through projection", async () => {
    const fetchWatchAnnotations = vi
      .fn()
      .mockResolvedValue(makePayload({ events: [], idle: true, nextCursor: null }));
    const api = makeApi({ fetchWatchAnnotations });
    const result = await watchAnnotationsHandler(
      { project_id: PROJECT_ID, wait_seconds: 1 },
      { auth: STUB_AUTH, api, idempotency: makeIdempotency(), requestId: "req_test" }
    );
    const parsed = watchAnnotationsOutputSchema.parse(result.structuredContent);
    expect(parsed.idle).toBe(true);
    expect(parsed.events).toEqual([]);
    expect(parsed.next_cursor).toBeNull();
  });
});
