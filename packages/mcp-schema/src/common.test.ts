import { describe, expect, test } from "vitest";
import {
  AGENT_UPDATE_STATUSES,
  MCP_COMMENT_KINDS,
  MCP_ERROR_CODES,
  OPEN_PR_STATUSES,
  TASK_STATUSES,
  TASK_TARGET_TYPES,
  agentUpdateStatusSchema,
  idempotencyKeySchema,
  mcpCommentKindSchema,
  mcpDomContextSchema,
  mcpErrorCodeSchema,
  mcpErrorPayloadSchema,
  mcpRelatedTaskSchema,
  mcpTaskAuthorSchema,
  mcpTaskSummarySchema,
  openPrStatusSchema,
} from "./common.js";

const validUuid = "00000000-0000-4000-8000-000000000001";
const validIso = "2026-04-22T10:00:00.000Z";

describe("mcpErrorCodeSchema", () => {
  test("accepts every spec §3.3 code", () => {
    for (const code of MCP_ERROR_CODES) {
      expect(mcpErrorCodeSchema.safeParse(code).success).toBe(true);
    }
  });

  test("rejects unknown codes", () => {
    expect(mcpErrorCodeSchema.safeParse("UNKNOWN").success).toBe(false);
    expect(mcpErrorCodeSchema.safeParse("unauthorized").success).toBe(false);
  });
});

describe("mcpErrorPayloadSchema", () => {
  test("accepts a minimal payload (code + message)", () => {
    expect(mcpErrorPayloadSchema.safeParse({ code: "FORBIDDEN", message: "no" }).success).toBe(
      true
    );
  });

  test("accepts a RATE_LIMIT payload with retry_after_seconds", () => {
    const result = mcpErrorPayloadSchema.safeParse({
      code: "RATE_LIMIT",
      message: "slow down",
      retry_after_seconds: 30,
    });
    expect(result.success).toBe(true);
  });

  test("accepts a VALIDATION_ERROR payload with details", () => {
    expect(
      mcpErrorPayloadSchema.safeParse({
        code: "VALIDATION_ERROR",
        message: "bad input",
        details: { issues: [{ path: ["task_id"], message: "required" }] },
      }).success
    ).toBe(true);
  });

  test("rejects retry_after_seconds < 0", () => {
    expect(
      mcpErrorPayloadSchema.safeParse({
        code: "RATE_LIMIT",
        message: "slow down",
        retry_after_seconds: -1,
      }).success
    ).toBe(false);
  });
});

describe("idempotencyKeySchema", () => {
  test("accepts a UUID", () => {
    expect(idempotencyKeySchema.safeParse(validUuid).success).toBe(true);
  });

  test("rejects non-UUID strings", () => {
    expect(idempotencyKeySchema.safeParse("not-a-uuid").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("").success).toBe(false);
  });
});

describe("agentUpdateStatusSchema", () => {
  test("accepts the three agent-writable statuses", () => {
    for (const status of AGENT_UPDATE_STATUSES) {
      expect(agentUpdateStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  test("rejects to_do (agents cannot reset a task)", () => {
    expect(agentUpdateStatusSchema.safeParse("to_do").success).toBe(false);
  });
});

describe("mcpCommentKindSchema", () => {
  test("accepts every spec comment kind", () => {
    for (const kind of MCP_COMMENT_KINDS) {
      expect(mcpCommentKindSchema.safeParse(kind).success).toBe(true);
    }
  });

  test("rejects unknown kinds", () => {
    expect(mcpCommentKindSchema.safeParse("note").success).toBe(false);
  });
});

describe("openPrStatusSchema", () => {
  test("accepts pending_github_integration and opened", () => {
    for (const status of OPEN_PR_STATUSES) {
      expect(openPrStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  test("rejects unknown statuses", () => {
    expect(openPrStatusSchema.safeParse("merged").success).toBe(false);
  });
});

describe("mcpDomContextSchema (snake_case wire format)", () => {
  test("accepts a fully populated snake_case context", () => {
    const result = mcpDomContextSchema.safeParse({
      tag_name: "button",
      classes: ["primary", "lg"],
      text_content: "Save",
      computed_styles: { color: "rgb(0, 0, 0)" },
      ancestors: [{ tag_name: "form", classes: ["signup"] }, { tag_name: "main" }],
    });
    expect(result.success).toBe(true);
  });

  test("accepts an empty object (every field optional)", () => {
    expect(mcpDomContextSchema.safeParse({}).success).toBe(true);
  });

  test("rejects ancestors entries that lack tag_name", () => {
    expect(
      mcpDomContextSchema.safeParse({
        ancestors: [{ classes: ["x"] }],
      }).success
    ).toBe(false);
  });
});

describe("mcpTaskAuthorSchema", () => {
  test("accepts a name + email pair", () => {
    expect(mcpTaskAuthorSchema.safeParse({ name: "Ada", email: "ada@example.com" }).success).toBe(
      true
    );
  });

  test("rejects when name is missing", () => {
    expect(mcpTaskAuthorSchema.safeParse({ email: "ada@example.com" }).success).toBe(false);
  });
});

describe("mcpTaskSummarySchema", () => {
  const valid = {
    id: validUuid,
    status: "to_do",
    branch: "main",
    project: { id: validUuid, slug: "acme" },
    url: "https://example.com",
    target_type: "element",
    comment_preview: "Make the button blue",
    author: { name: "Ada", email: "ada@example.com" },
    created_at: validIso,
    has_screenshot: true,
  };

  test("accepts a complete summary", () => {
    expect(mcpTaskSummarySchema.safeParse(valid).success).toBe(true);
  });

  test("accepts personal-mode shape (branch + project null)", () => {
    expect(mcpTaskSummarySchema.safeParse({ ...valid, branch: null, project: null }).success).toBe(
      true
    );
  });

  test("rejects when has_screenshot is missing", () => {
    const { has_screenshot: _, ...withoutFlag } = valid;
    expect(mcpTaskSummarySchema.safeParse(withoutFlag).success).toBe(false);
  });

  test("rejects when status is not a valid task status", () => {
    expect(mcpTaskSummarySchema.safeParse({ ...valid, status: "unknown" }).success).toBe(false);
  });

  test("rejects when target_type is not a valid task target type", () => {
    expect(mcpTaskSummarySchema.safeParse({ ...valid, target_type: "polygon" }).success).toBe(
      false
    );
  });
});

describe("mcpRelatedTaskSchema", () => {
  test("accepts a valid related task", () => {
    expect(
      mcpRelatedTaskSchema.safeParse({
        id: validUuid,
        comment_preview: "Other thing",
        status: "doing",
      }).success
    ).toBe(true);
  });
});

describe("re-exported enums", () => {
  test("TASK_STATUSES matches the wire spec", () => {
    expect([...TASK_STATUSES]).toEqual(["to_do", "doing", "done", "rejected", "acknowledged"]);
  });

  test("TASK_TARGET_TYPES matches the wire spec", () => {
    expect([...TASK_TARGET_TYPES]).toEqual(["element", "rectangle", "route"]);
  });
});
