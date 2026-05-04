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
  watchAnnotationsInputSchema,
  whoamiInputSchema,
} from "./tools.js";

const uuid = "00000000-0000-4000-8000-000000000001";
const otherUuid = "00000000-0000-4000-8000-000000000002";

// Tool list grew from 8 to 12 in ADR-0018 (G6/G7/G8a/G8b agent-loop tools);
// G10 (watch_annotations) appended at the end brings the total to 13.
// New tools slot between the existing mutators and the batching helper so
// related verbs cluster together in the tools/list manifest.
const SPEC_TOOL_NAMES: readonly RemarksToolName[] = [
  "remarks_list_tasks",
  "remarks_get_task",
  "remarks_update_task_status",
  "remarks_add_task_comment",
  "remarks_acknowledge",
  "remarks_dismiss",
  "remarks_get_pending",
  "remarks_get_all_pending",
  "remarks_batch_update_status",
  "remarks_get_project_context",
  "remarks_open_pr",
  "remarks_whoami",
  "remarks_watch_annotations",
];

describe("REMARKS_TOOLS registry", () => {
  test("exposes exactly 13 tools (G10 watch_annotations)", () => {
    expect(REMARKS_TOOLS).toHaveLength(13);
    expect(REMARKS_TOOL_NAMES).toHaveLength(13);
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

  test("accepts a rejected transition with reason + idempotency_key", () => {
    expect(
      updateTaskStatusInputSchema.safeParse({
        task_id: uuid,
        status: "rejected",
        reason: "out of scope for this sprint",
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

  // G4
  test("rejects a rejected transition without a reason", () => {
    expect(
      updateTaskStatusInputSchema.safeParse({ task_id: uuid, status: "rejected" }).success
    ).toBe(false);
  });

  test("rejects a too-short reason on rejected", () => {
    expect(
      updateTaskStatusInputSchema.safeParse({
        task_id: uuid,
        status: "rejected",
        reason: "nope",
      }).success
    ).toBe(false);
  });

  test("rejects a reason on a non-rejected transition", () => {
    expect(
      updateTaskStatusInputSchema.safeParse({
        task_id: uuid,
        status: "doing",
        reason: "starting work on this",
      }).success
    ).toBe(false);
  });

  test("trims the reason before length validation", () => {
    const parsed = updateTaskStatusInputSchema.safeParse({
      task_id: uuid,
      status: "rejected",
      reason: "   duplicate ticket  ",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.reason).toBe("duplicate ticket");
    }
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

  // G4
  test("rejects when a row has status: rejected without a reason", () => {
    expect(
      batchUpdateStatusInputSchema.safeParse({
        updates: [{ task_id: uuid, status: "rejected" }],
      }).success
    ).toBe(false);
  });

  test("accepts a row with status: rejected and a valid reason", () => {
    expect(
      batchUpdateStatusInputSchema.safeParse({
        updates: [{ task_id: uuid, status: "rejected", reason: "duplicate of #123" }],
      }).success
    ).toBe(true);
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

describe("watchAnnotationsInputSchema", () => {
  test("accepts an empty object — defaults to scope=all (per the description)", () => {
    const r = watchAnnotationsInputSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      // No scope marker is allowed; defaults populate.
      expect(r.data.wait_seconds).toBe(30);
      expect(r.data.batch_window_ms).toBe(250);
      expect(r.data.limit).toBe(25);
      expect(r.data.auto_acknowledge).toBe(false);
    }
  });

  test("accepts a single scope marker", () => {
    expect(watchAnnotationsInputSchema.safeParse({ project_id: uuid }).success).toBe(true);
    expect(watchAnnotationsInputSchema.safeParse({ org_id: uuid }).success).toBe(true);
    expect(watchAnnotationsInputSchema.safeParse({ scope: "personal" }).success).toBe(true);
    expect(watchAnnotationsInputSchema.safeParse({ scope: "all" }).success).toBe(true);
  });

  test("rejects two scope markers (mutex)", () => {
    expect(
      watchAnnotationsInputSchema.safeParse({ project_id: uuid, org_id: otherUuid }).success
    ).toBe(false);
    expect(
      watchAnnotationsInputSchema.safeParse({ project_id: uuid, scope: "personal" }).success
    ).toBe(false);
    expect(watchAnnotationsInputSchema.safeParse({ org_id: uuid, scope: "all" }).success).toBe(
      false
    );
  });

  test("branch filter requires project_id", () => {
    expect(watchAnnotationsInputSchema.safeParse({ branch: "main", scope: "all" }).success).toBe(
      false
    );
    expect(
      watchAnnotationsInputSchema.safeParse({ branch: "main", project_id: uuid }).success
    ).toBe(true);
  });

  test("filter arrays validate enum members", () => {
    expect(
      watchAnnotationsInputSchema.safeParse({ project_id: uuid, intent: ["fix"] }).success
    ).toBe(true);
    expect(
      watchAnnotationsInputSchema.safeParse({ project_id: uuid, intent: ["bogus"] }).success
    ).toBe(false);
    expect(
      watchAnnotationsInputSchema.safeParse({ project_id: uuid, severity: ["blocking"] }).success
    ).toBe(true);
    expect(
      watchAnnotationsInputSchema.safeParse({
        project_id: uuid,
        event_types: ["created", "comment_added"],
      }).success
    ).toBe(true);
  });

  test("wait_seconds bounds: 0..55", () => {
    expect(
      watchAnnotationsInputSchema.safeParse({ project_id: uuid, wait_seconds: 0 }).success
    ).toBe(true);
    expect(
      watchAnnotationsInputSchema.safeParse({ project_id: uuid, wait_seconds: 55 }).success
    ).toBe(true);
    expect(
      watchAnnotationsInputSchema.safeParse({ project_id: uuid, wait_seconds: 56 }).success
    ).toBe(false);
    expect(
      watchAnnotationsInputSchema.safeParse({ project_id: uuid, wait_seconds: -1 }).success
    ).toBe(false);
  });
});
