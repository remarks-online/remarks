import { describe, expect, test } from "vitest";
import {
  REMARKS_TOOLS,
  REMARKS_TOOL_NAMES,
  type RemarksToolName,
  addTaskCommentInputSchema,
  batchUpdateStatusInputSchema,
  getProjectContextInputSchema,
  getTaskInputSchema,
  listTasksInputSchema,
  openPrInputSchema,
  updateTaskStatusInputSchema,
  whoamiInputSchema,
} from "./tools.js";

const uuid = "00000000-0000-4000-8000-000000000001";
const otherUuid = "00000000-0000-4000-8000-000000000002";

const SPEC_TOOL_NAMES: readonly RemarksToolName[] = [
  "remarks_list_tasks",
  "remarks_get_task",
  "remarks_update_task_status",
  "remarks_add_task_comment",
  "remarks_batch_update_status",
  "remarks_get_project_context",
  "remarks_open_pr",
  "remarks_whoami",
];

describe("REMARKS_TOOLS registry", () => {
  test("exposes exactly 8 tools (Phase 2 spec §3.2)", () => {
    expect(REMARKS_TOOLS).toHaveLength(8);
    expect(REMARKS_TOOL_NAMES).toHaveLength(8);
  });

  test("tool names match the spec list, in spec order", () => {
    expect([...REMARKS_TOOL_NAMES]).toEqual(SPEC_TOOL_NAMES);
  });

  test("every tool name uses the remarks_ namespace prefix (§3.1)", () => {
    for (const tool of REMARKS_TOOLS) {
      expect(tool.name.startsWith("remarks_")).toBe(true);
    }
  });

  test("every tool has a non-empty description", () => {
    for (const tool of REMARKS_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  test("every tool exposes input and output schemas", () => {
    for (const tool of REMARKS_TOOLS) {
      expect(typeof tool.input.safeParse).toBe("function");
      expect(typeof tool.output.safeParse).toBe("function");
    }
  });

  test("tool names are unique", () => {
    const set = new Set(REMARKS_TOOL_NAMES);
    expect(set.size).toBe(REMARKS_TOOL_NAMES.length);
  });
});

describe("listTasksInputSchema", () => {
  test("accepts a minimal payload (project_id only) and applies the default limit", () => {
    const result = listTasksInputSchema.safeParse({ project_id: uuid });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
    }
  });

  test("accepts a fully populated payload", () => {
    expect(
      listTasksInputSchema.safeParse({
        project_id: uuid,
        branch: "main",
        status: ["to_do", "doing"],
        limit: 50,
        cursor: "opaque-cursor",
      }).success
    ).toBe(true);
  });

  test("rejects when project_id is not a UUID", () => {
    expect(listTasksInputSchema.safeParse({ project_id: "abc" }).success).toBe(false);
  });

  test("rejects limit > 100", () => {
    expect(listTasksInputSchema.safeParse({ project_id: uuid, limit: 101 }).success).toBe(false);
  });

  test("rejects an unknown status enum value", () => {
    expect(listTasksInputSchema.safeParse({ project_id: uuid, status: ["closed"] }).success).toBe(
      false
    );
  });
});

describe("getTaskInputSchema", () => {
  test("accepts a UUID task_id", () => {
    expect(getTaskInputSchema.safeParse({ task_id: uuid }).success).toBe(true);
  });

  test("rejects when task_id is missing", () => {
    expect(getTaskInputSchema.safeParse({}).success).toBe(false);
  });
});

describe("updateTaskStatusInputSchema", () => {
  test("accepts a doing transition", () => {
    expect(updateTaskStatusInputSchema.safeParse({ task_id: uuid, status: "doing" }).success).toBe(
      true
    );
  });

  test("accepts a rejected transition with note + idempotency_key", () => {
    expect(
      updateTaskStatusInputSchema.safeParse({
        task_id: uuid,
        status: "rejected",
        note: "out of scope",
        idempotency_key: otherUuid,
      }).success
    ).toBe(true);
  });

  test("rejects to_do (agents cannot reset)", () => {
    expect(updateTaskStatusInputSchema.safeParse({ task_id: uuid, status: "to_do" }).success).toBe(
      false
    );
  });

  test("rejects a non-UUID idempotency_key", () => {
    expect(
      updateTaskStatusInputSchema.safeParse({
        task_id: uuid,
        status: "doing",
        idempotency_key: "not-a-uuid",
      }).success
    ).toBe(false);
  });
});

describe("addTaskCommentInputSchema", () => {
  test("accepts a minimal comment", () => {
    expect(addTaskCommentInputSchema.safeParse({ task_id: uuid, comment: "ok" }).success).toBe(
      true
    );
  });

  test("accepts a kind tag", () => {
    expect(
      addTaskCommentInputSchema.safeParse({
        task_id: uuid,
        comment: "Need clarification",
        kind: "clarification_request",
      }).success
    ).toBe(true);
  });

  test("rejects an empty comment", () => {
    expect(addTaskCommentInputSchema.safeParse({ task_id: uuid, comment: "" }).success).toBe(false);
  });

  test("rejects a comment over 5000 chars", () => {
    expect(
      addTaskCommentInputSchema.safeParse({
        task_id: uuid,
        comment: "x".repeat(5001),
      }).success
    ).toBe(false);
  });
});

describe("batchUpdateStatusInputSchema", () => {
  test("accepts a single update", () => {
    expect(
      batchUpdateStatusInputSchema.safeParse({
        updates: [{ task_id: uuid, status: "done" }],
      }).success
    ).toBe(true);
  });

  test("accepts 50 updates", () => {
    const updates = Array.from({ length: 50 }, () => ({
      task_id: uuid,
      status: "done" as const,
    }));
    expect(batchUpdateStatusInputSchema.safeParse({ updates }).success).toBe(true);
  });

  test("rejects an empty updates array", () => {
    expect(batchUpdateStatusInputSchema.safeParse({ updates: [] }).success).toBe(false);
  });

  test("rejects 51 updates", () => {
    const updates = Array.from({ length: 51 }, () => ({
      task_id: uuid,
      status: "done" as const,
    }));
    expect(batchUpdateStatusInputSchema.safeParse({ updates }).success).toBe(false);
  });

  test("rejects to_do transitions inside the batch", () => {
    expect(
      batchUpdateStatusInputSchema.safeParse({
        updates: [{ task_id: uuid, status: "to_do" }],
      }).success
    ).toBe(false);
  });
});

describe("getProjectContextInputSchema", () => {
  test("accepts a UUID project_id", () => {
    expect(getProjectContextInputSchema.safeParse({ project_id: uuid }).success).toBe(true);
  });
});

describe("openPrInputSchema", () => {
  test("accepts a minimal payload", () => {
    expect(
      openPrInputSchema.safeParse({
        project_id: uuid,
        task_ids: [uuid],
        branch: "feat/something",
      }).success
    ).toBe(true);
  });

  test("rejects an empty task_ids array", () => {
    expect(
      openPrInputSchema.safeParse({
        project_id: uuid,
        task_ids: [],
        branch: "feat/x",
      }).success
    ).toBe(false);
  });

  test("rejects more than 50 task_ids", () => {
    expect(
      openPrInputSchema.safeParse({
        project_id: uuid,
        task_ids: Array.from({ length: 51 }, () => uuid),
        branch: "feat/x",
      }).success
    ).toBe(false);
  });
});

describe("whoamiInputSchema", () => {
  test("accepts an empty object (no inputs required)", () => {
    expect(whoamiInputSchema.safeParse({}).success).toBe(true);
  });
});
