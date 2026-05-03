import { MAX_COMMENT_LENGTH, rejectionReasonSchema } from "@remarks/shared";
import { z } from "zod";
import {
  agentUpdateStatusSchema,
  idempotencyKeySchema,
  mcpCommentKindSchema,
  mcpDomContextSchema,
  mcpRelatedTaskSchema,
  mcpTaskAuthorSchema,
  mcpTaskProjectSchema,
  mcpTaskSummarySchema,
  openPrStatusSchema,
  rectSchema,
  taskStatusSchema,
  taskTargetTypeSchema,
  viewportSchema,
} from "./common.js";

// --- remarks_list_tasks (Phase 2 spec §3.2 Discovery; A21 personal + org modes) ---

export const listTasksInputSchema = z
  .object({
    // Mode selector — exactly one of {project_id, org_id, neither} is allowed.
    // - project_id set    → tasks for that project (membership required)
    // - org_id set        → tasks across the caller's projects in that org
    // - neither set       → caller's personal tasks (annotations with no project)
    project_id: z.string().uuid().optional(),
    org_id: z.string().uuid().optional(),
    // `branch` is project-specific; refinement below rejects it without project_id.
    branch: z.string().optional(),
    // Spec defaults to ["to_do", "doing"] when omitted; the server applies that
    // default — keeping the schema permissive lets clients pass an empty array
    // for "all statuses" without hitting a refinement.
    status: z.array(taskStatusSchema).optional(),
    limit: z.number().int().min(1).max(100).default(20),
    cursor: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.project_id !== undefined && value.org_id !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "project_id and org_id are mutually exclusive",
        path: ["org_id"],
      });
    }
    if (value.branch !== undefined && value.project_id === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "branch filter requires project_id",
        path: ["branch"],
      });
    }
  });

export type ListTasksInput = z.infer<typeof listTasksInputSchema>;

export const listTasksOutputSchema = z.object({
  tasks: z.array(mcpTaskSummarySchema),
  next_cursor: z.string().nullable(),
});

export type ListTasksOutput = z.infer<typeof listTasksOutputSchema>;

const listTasksTool = {
  name: "remarks_list_tasks",
  description:
    "Returns Remarks tasks. Tasks are visual feedback items that a human has left on a running web application. Pass `project_id` to list tasks for a single project, `org_id` to list tasks across all of the caller's projects in that organization, or omit both to list the caller's personal tasks (annotations with no project). The two ID inputs are mutually exclusive. The `branch` filter is only valid with `project_id`. Default status filter returns open (to_do) and in-progress (doing) tasks. Personal-task rows return `branch: null` and `project: null`. Call `remarks_get_task` to get full context for a specific task.",
  input: listTasksInputSchema,
  output: listTasksOutputSchema,
} as const;

// --- remarks_get_task (Phase 2 spec §3.2 Working with a single task) ---

export const getTaskInputSchema = z.object({
  task_id: z.string().uuid(),
});

export type GetTaskInput = z.infer<typeof getTaskInputSchema>;

export const getTaskOutputSchema = z.object({
  id: z.string().uuid(),
  status: taskStatusSchema,
  // Null for personal tasks (no project, therefore no branch). Always set
  // for project-scoped tasks. Mirrors the same field on `mcpTaskSummarySchema`.
  branch: z.string().nullable(),
  // Null for personal tasks; populated for project-scoped tasks. Same shape
  // as on the list endpoint.
  project: mcpTaskProjectSchema.nullable(),
  url: z.string().url(),
  comment: z.string(),
  target: z.object({
    type: taskTargetTypeSchema,
    selector: z.string().optional(),
    coords: rectSchema.optional(),
  }),
  viewport: viewportSchema,
  dom_context: mcpDomContextSchema.nullable(),
  framework_hint: z.string().nullable(),
  // Presigned URL with ~1h expiry; null when the task has no screenshot.
  screenshot_url: z.string().url().nullable(),
  author: mcpTaskAuthorSchema,
  related_tasks: z.array(mcpRelatedTaskSchema),
  // G17: shared id across rows that were created from the same multi-select
  // capture. Null on every single-pick task. `group_size` is denormalized so
  // agents can tell at a glance whether siblings exist without a follow-up
  // call; siblings already surface in `related_tasks`.
  group_id: z.string().uuid().nullable(),
  group_size: z.number().int().positive().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type GetTaskOutput = z.infer<typeof getTaskOutputSchema>;

const getTaskTool = {
  name: "remarks_get_task",
  description:
    "Returns full context for a single Remarks task. Works for both project-scoped tasks (caller must be a project member) and personal tasks (caller must be the author). The `target.selector` is the primary targeting signal — it's the CSS selector of the element the user clicked. The `screenshot_url` is supplementary visual context; fetch it only if your model is multimodal. The `related_tasks` array lists other tasks on the same URL or targeting the same element; check them for dependencies before making changes (e.g., if one task says 'make blue' and another says 'add shadow', implement blue first). Personal tasks return `branch: null` and `project: null`.",
  input: getTaskInputSchema,
  output: getTaskOutputSchema,
} as const;

// --- remarks_update_task_status ---

// G4: rejecting a task requires a `reason` (10–500 chars, trimmed) that
// lands in the resulting event payload so reviewers see why the agent
// dismissed the work. `note` stays as optional commentary for non-rejection
// transitions (e.g. "starting work" with status: doing). The shared
// `rejectionReasonSchema` (re-used from packages/shared) keeps the bounds
// identical across the user-auth and MCP request bodies.
export const updateTaskStatusInputSchema = z
  .object({
    task_id: z.string().uuid(),
    status: agentUpdateStatusSchema,
    note: z.string().optional(),
    reason: rejectionReasonSchema.optional(),
    idempotency_key: idempotencyKeySchema.optional(),
  })
  .refine((data) => !(data.status === "rejected") || data.reason !== undefined, {
    message: "reason is required when status is rejected",
    path: ["reason"],
  })
  .refine((data) => data.reason === undefined || data.status === "rejected", {
    message: "reason is only allowed when status is rejected",
    path: ["reason"],
  });

export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusInputSchema>;

export const updateTaskStatusOutputSchema = z.object({
  id: z.string().uuid(),
  status: agentUpdateStatusSchema,
  updated_at: z.string().datetime(),
});

export type UpdateTaskStatusOutput = z.infer<typeof updateTaskStatusOutputSchema>;

const updateTaskStatusTool = {
  name: "remarks_update_task_status",
  description:
    "Updates a task's status. Use `acknowledged` to confirm receipt of a task without committing to do it yet (useful when triaging a batch). Use `doing` when starting work, `done` when the code change is committed, `rejected` if the task cannot or should not be done. **A `reason` is required when status is `rejected` (10–500 chars)** — it surfaces in the task's activity feed so the reviewer understands the dismissal. `note` is optional free-form commentary for non-rejection transitions (e.g. \"starting work\" with status: doing). Typical sequence: to_do → (acknowledged →) doing → done. Skipping intermediate states is allowed but loses useful signal about progress.",
  input: updateTaskStatusInputSchema,
  output: updateTaskStatusOutputSchema,
} as const;

// --- remarks_add_task_comment ---

export const addTaskCommentInputSchema = z.object({
  task_id: z.string().uuid(),
  comment: z.string().min(1).max(MAX_COMMENT_LENGTH),
  kind: mcpCommentKindSchema.optional(),
  idempotency_key: idempotencyKeySchema.optional(),
});

export type AddTaskCommentInput = z.infer<typeof addTaskCommentInputSchema>;

export const addTaskCommentOutputSchema = z.object({
  event_id: z.string().uuid(),
  created_at: z.string().datetime(),
});

export type AddTaskCommentOutput = z.infer<typeof addTaskCommentOutputSchema>;

const addTaskCommentTool = {
  name: "remarks_add_task_comment",
  description:
    "Adds a comment to a task. Use this to ask the human for clarification, explain a decision that wasn't obvious, or note completion details. The comment appears in the Remarks dashboard as an agent-authored event. Prefer doing the work over asking questions, but when a task is genuinely ambiguous, ask.",
  input: addTaskCommentInputSchema,
  output: addTaskCommentOutputSchema,
} as const;

// --- remarks_acknowledge (G6: agentation parity) ---

export const acknowledgeInputSchema = z
  .object({
    task_id: z.string().uuid(),
    comment: z.string().min(1).max(MAX_COMMENT_LENGTH).optional(),
    kind: mcpCommentKindSchema.optional(),
    idempotency_key: idempotencyKeySchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind !== undefined && value.comment === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "kind requires comment",
        path: ["kind"],
      });
    }
  });

export type AcknowledgeInput = z.infer<typeof acknowledgeInputSchema>;

export const acknowledgeOutputSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("acknowledged"),
  updated_at: z.string().datetime(),
  // Set when the caller passed a comment; null otherwise. Lets the agent
  // correlate the appended event without a follow-up read.
  comment_event_id: z.string().uuid().nullable(),
});

export type AcknowledgeOutput = z.infer<typeof acknowledgeOutputSchema>;

const acknowledgeTool = {
  name: "remarks_acknowledge",
  description:
    "Marks a task as acknowledged — the agent has read it but hasn't started work yet. Useful when triaging a batch: acknowledge everything you intend to handle so the human knows you've seen it, then call `remarks_update_task_status` with `doing` when you actually start. Pass `comment` to leave a note alongside the acknowledgement (e.g., asking for clarification before starting). The `kind` field categorizes the comment and only applies when `comment` is set.",
  input: acknowledgeInputSchema,
  output: acknowledgeOutputSchema,
} as const;

// --- remarks_dismiss (G7: agentation parity) ---

export const dismissInputSchema = z.object({
  task_id: z.string().uuid(),
  reason: rejectionReasonSchema,
  idempotency_key: idempotencyKeySchema.optional(),
});

export type DismissInput = z.infer<typeof dismissInputSchema>;

export const dismissOutputSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("rejected"),
  updated_at: z.string().datetime(),
});

export type DismissOutput = z.infer<typeof dismissOutputSchema>;

const dismissTool = {
  name: "remarks_dismiss",
  description:
    "Rejects a task with a required reason. Use this when the task can't or shouldn't be done — e.g., the request is out of scope, conflicts with a constraint, or has already been resolved by other work. The reason is recorded on the status-change event and surfaced to the human in the dashboard. Reason must be at least 10 characters; opaque rejections aren't useful for review. Equivalent to `remarks_update_task_status` with `status: rejected` plus a required reason — prefer this tool when dismissing so the contract is explicit.",
  input: dismissInputSchema,
  output: dismissOutputSchema,
} as const;

// --- remarks_get_pending (G8a: project-scoped triage) ---

export const getPendingInputSchema = z.object({
  project_id: z.string().uuid(),
  branch: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type GetPendingInput = z.infer<typeof getPendingInputSchema>;

export const getPendingOutputSchema = listTasksOutputSchema;

export type GetPendingOutput = z.infer<typeof getPendingOutputSchema>;

const getPendingTool = {
  name: "remarks_get_pending",
  description:
    "Returns tasks in a project that are pending agent work — status is `to_do` (no agent has picked it up) or `acknowledged` (an agent has read it but isn't actively working). Excludes `doing` (someone else is on it) and terminal states (`done`, `rejected`). Use this for triage: call at the start of a session to see what needs attention. Equivalent to `remarks_list_tasks` with `project_id` and `status: ['to_do', 'acknowledged']`, but more direct.",
  input: getPendingInputSchema,
  output: getPendingOutputSchema,
} as const;

// --- remarks_get_all_pending (G8b: cross-scope triage) ---

export const getAllPendingInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type GetAllPendingInput = z.infer<typeof getAllPendingInputSchema>;

export const getAllPendingOutputSchema = listTasksOutputSchema;

export type GetAllPendingOutput = z.infer<typeof getAllPendingOutputSchema>;

const getAllPendingTool = {
  name: "remarks_get_all_pending",
  description:
    "Returns all tasks the caller can see that are pending agent work, across personal annotations and every project the caller is a member of (regardless of org). Status filter is `to_do` or `acknowledged`. Use this when the agent operates across multiple projects and wants a single view of work to do. For project-scoped triage, use `remarks_get_pending` instead.",
  input: getAllPendingInputSchema,
  output: getAllPendingOutputSchema,
} as const;

// --- remarks_batch_update_status (Phase 2 spec §3.2 Batching) ---

// G4: each update row carries the same rejection contract as the single-update
// tool — `reason` required when status is `rejected`, refused otherwise.
const batchUpdateStatusUpdateSchema = z
  .object({
    task_id: z.string().uuid(),
    status: agentUpdateStatusSchema,
    note: z.string().optional(),
    reason: rejectionReasonSchema.optional(),
  })
  .refine((data) => !(data.status === "rejected") || data.reason !== undefined, {
    message: "reason is required when status is rejected",
    path: ["reason"],
  })
  .refine((data) => data.reason === undefined || data.status === "rejected", {
    message: "reason is only allowed when status is rejected",
    path: ["reason"],
  });

export const batchUpdateStatusInputSchema = z.object({
  updates: z.array(batchUpdateStatusUpdateSchema).min(1).max(50),
  idempotency_key: idempotencyKeySchema.optional(),
});

export type BatchUpdateStatusInput = z.infer<typeof batchUpdateStatusInputSchema>;

export const batchUpdateStatusOutputSchema = z.object({
  results: z.array(
    z.object({
      task_id: z.string().uuid(),
      success: z.boolean(),
      error: z.string().optional(),
    })
  ),
});

export type BatchUpdateStatusOutput = z.infer<typeof batchUpdateStatusOutputSchema>;

const batchUpdateStatusTool = {
  name: "remarks_batch_update_status",
  description:
    "Updates multiple task statuses in a single call. Use this when processing a batch of related tasks to reduce round-trips. Each row follows the same rules as `remarks_update_task_status` — in particular, a `reason` (10–500 chars) is required on any row whose status is `rejected`. Partial failures are reported per-task; the call itself does not fail if individual updates fail.",
  input: batchUpdateStatusInputSchema,
  output: batchUpdateStatusOutputSchema,
} as const;

// --- remarks_get_project_context (Phase 2 spec §3.2 Context gathering) ---

export const getProjectContextInputSchema = z.object({
  project_id: z.string().uuid(),
});

export type GetProjectContextInput = z.infer<typeof getProjectContextInputSchema>;

export const getProjectContextOutputSchema = z.object({
  project: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    primary_branch: z.string(),
    // Null until the GitHub integration ships in Phase 3.
    git_repo_url: z.string().url().nullable(),
  }),
  active_branches: z.array(
    z.object({
      name: z.string(),
      open_task_count: z.number().int().nonnegative(),
      last_activity: z.string().datetime(),
    })
  ),
  // Reserved for the year-2 design-system integration; always null in Phase 2.
  design_tokens: z.null(),
});

export type GetProjectContextOutput = z.infer<typeof getProjectContextOutputSchema>;

const getProjectContextTool = {
  name: "remarks_get_project_context",
  description:
    "Returns project metadata and a list of branches with open tasks. Call this at the start of a work session to understand what's available. The `design_tokens` field will be populated in a future phase; currently null.",
  input: getProjectContextInputSchema,
  output: getProjectContextOutputSchema,
} as const;

// --- remarks_open_pr (Phase 2 spec §3.2 PR integration; stub until Phase 3) ---

export const openPrInputSchema = z.object({
  project_id: z.string().uuid(),
  task_ids: z.array(z.string().uuid()).min(1).max(50),
  branch: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  idempotency_key: idempotencyKeySchema.optional(),
});

export type OpenPrInput = z.infer<typeof openPrInputSchema>;

export const openPrOutputSchema = z.object({
  status: openPrStatusSchema,
  pr_url: z.string().url().nullable(),
  message: z.string(),
});

export type OpenPrOutput = z.infer<typeof openPrOutputSchema>;

const openPrTool = {
  name: "remarks_open_pr",
  description:
    "Signals that a set of Remarks tasks has been completed on a branch. In Phase 2, this records the intent and returns `pending_github_integration`; actual PR creation ships in Phase 3 once the GitHub App is installed. Call this when all task code changes are committed locally.",
  input: openPrInputSchema,
  output: openPrOutputSchema,
} as const;

// --- remarks_whoami (Phase 2 spec §3.2 Health) ---

export const whoamiInputSchema = z.object({});

export type WhoamiInput = z.infer<typeof whoamiInputSchema>;

export const whoamiOutputSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().nullable(),
    name: z.string().nullable(),
  }),
  projects: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      slug: z.string(),
    })
  ),
  // Orgs the caller belongs to (Clerk-authoritative). The `id` is the Remarks
  // organization UUID; `clerk_org_id` is the Clerk identifier. Pass `id` as
  // `org_id` to `remarks_list_tasks` to list tasks across the caller's
  // projects within that org.
  orgs: z.array(
    z.object({
      id: z.string().uuid(),
      clerk_org_id: z.string(),
      name: z.string(),
      slug: z.string(),
      role: z.string(),
    })
  ),
  oauth_client_name: z.string(),
  granted_scopes: z.array(z.string()),
  server_version: z.string(),
  skill_version: z.string(),
});

export type WhoamiOutput = z.infer<typeof whoamiOutputSchema>;

const whoamiTool = {
  name: "remarks_whoami",
  description:
    "Returns information about the current Remarks connection. Use this to verify connectivity and see which projects and organizations the authenticated user has access to. Tokens are scoped to a Clerk user (ADR-0015); one grant covers every project the user is a member of and every org the user belongs to. Use the returned `org` IDs to drive `remarks_list_tasks` in org mode, or call `remarks_list_tasks` with no IDs to list the caller's personal tasks.",
  input: whoamiInputSchema,
  output: whoamiOutputSchema,
} as const;

// --- Registry (single source of truth for the MCP server) ---

export const REMARKS_TOOLS = [
  listTasksTool,
  getTaskTool,
  updateTaskStatusTool,
  addTaskCommentTool,
  acknowledgeTool,
  dismissTool,
  getPendingTool,
  getAllPendingTool,
  batchUpdateStatusTool,
  getProjectContextTool,
  openPrTool,
  whoamiTool,
] as const;

export type RemarksTool = (typeof REMARKS_TOOLS)[number];
export type RemarksToolName = RemarksTool["name"];

export const REMARKS_TOOL_NAMES: readonly RemarksToolName[] = REMARKS_TOOLS.map(
  (tool) => tool.name
);
