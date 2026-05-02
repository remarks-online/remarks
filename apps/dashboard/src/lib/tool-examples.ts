// User-facing example prompts and tool blurbs for the connect-agent page.
//
// The set of tools is sourced from `@remarks/mcp-schema`'s `REMARKS_TOOLS`
// registry. The descriptions in that file are tuned for agents (verbose,
// jargon-heavy). The blurbs and prompts here are tuned for the human reader
// who just connected their agent and is wondering what to ask it.
//
// `TOOL_BLURBS` is keyed by `RemarksToolName`, so adding a new tool to the
// registry without giving it a blurb is a typecheck failure.

import type { RemarksToolName } from "@remarks/mcp-schema";

export type ExamplePromptPhase =
  | "Getting oriented"
  | "Finding work"
  | "Picking up a task"
  | "Doing the work"
  | "Wrapping up";

export interface ExamplePrompt {
  id: string;
  phase: ExamplePromptPhase;
  prompt: string;
  tools: readonly RemarksToolName[];
  outcome: string;
}

export const EXAMPLE_PROMPTS: readonly ExamplePrompt[] = [
  {
    id: "whoami",
    phase: "Getting oriented",
    prompt: "Confirm I'm connected to Remarks and show me which projects and orgs you can see.",
    tools: ["remarks_whoami"],
    outcome:
      "A sanity check after install. Lists your email, the projects you're a member of, and the scopes the agent was granted.",
  },
  {
    id: "project-context",
    phase: "Getting oriented",
    prompt:
      "What's in my marketing-site project? Open task count per branch, repo URL, anything I should know.",
    tools: ["remarks_get_project_context"],
    outcome:
      "Project metadata plus a per-branch summary so the agent can plan which branch to focus on first.",
  },
  {
    id: "all-pending",
    phase: "Finding work",
    prompt: "List the Remarks tasks waiting on me across everything.",
    tools: ["remarks_get_all_pending"],
    outcome:
      "Cross-project triage view — every to_do or acknowledged task across your personal annotations and every project you can see.",
  },
  {
    id: "project-pending",
    phase: "Finding work",
    prompt: "What's pending on the web-app project right now?",
    tools: ["remarks_get_pending"],
    outcome:
      "Project-scoped triage. Same shape as `get_all_pending` but filtered to one project and optionally one branch.",
  },
  {
    id: "personal-list",
    phase: "Finding work",
    prompt: "Show me my personal Remarks — annotations I left while browsing.",
    tools: ["remarks_list_tasks"],
    outcome:
      "Pass no project_id and no org_id and `list_tasks` runs in personal mode, returning the annotations you captured with the browser extension.",
  },
  {
    id: "get-task",
    phase: "Picking up a task",
    prompt:
      "Open task 8b1f… and tell me what's on screen — the selector, the screenshot, and any related tasks.",
    tools: ["remarks_get_task"],
    outcome:
      "Full context for a single task: target selector, viewport, DOM context hint, screenshot URL, and a list of related tasks so the agent can spot dependencies before editing.",
  },
  {
    id: "ack-batch",
    phase: "Picking up a task",
    prompt:
      "Acknowledge every open task on the marketing-site project so the team knows I've seen them, then summarise what's there.",
    tools: ["remarks_list_tasks", "remarks_acknowledge"],
    outcome:
      "Bulk triage without committing to do them yet. Each acknowledgement appears in the dashboard activity feed.",
  },
  {
    id: "loop",
    phase: "Doing the work",
    prompt:
      "Pick up the top three tasks on web-app, mark them in progress, implement each one, then mark them all done in a single batch.",
    tools: ["remarks_get_pending", "remarks_update_task_status", "remarks_batch_update_status"],
    outcome:
      "End-to-end loop: discover → claim with `doing` → implement → batch the terminal status update so the dashboard sees them all complete at once.",
  },
  {
    id: "comment",
    phase: "Doing the work",
    prompt:
      "On task 8b1f…, ask the human which color token they want — I can't tell from the screenshot.",
    tools: ["remarks_add_task_comment"],
    outcome:
      "An agent-authored comment lands on the task with `kind: clarification_request` so the reviewer can answer inline.",
  },
  {
    id: "dismiss",
    phase: "Wrapping up",
    prompt:
      "Reject task 8b1f… — the request conflicts with our brand guidelines and shouldn't be implemented.",
    tools: ["remarks_dismiss"],
    outcome:
      "Rejection requires a 10–500 character reason. The reason is stored on the status-change event and shown to the human in the activity feed.",
  },
  {
    id: "open-pr",
    phase: "Wrapping up",
    prompt: "I just shipped tasks A, B, and C on the feat/buttons branch — open a PR for them.",
    tools: ["remarks_open_pr"],
    outcome:
      "Records the intent and links the tasks to the branch. In the current phase the response is `pending_github_integration`; once the GitHub App is installed this becomes a real PR.",
  },
] as const;

export const TOOL_BLURBS: Record<RemarksToolName, string> = {
  remarks_whoami:
    "Verify the connection. Returns your user info, the projects and orgs the token can see, and the granted scopes.",
  remarks_list_tasks:
    "List tasks. Pass `project_id` for one project, `org_id` for every project in an org, or omit both for your personal annotations.",
  remarks_get_task:
    "Fetch full context for a single task — selector, viewport, DOM hint, screenshot, related tasks.",
  remarks_get_project_context:
    "Project metadata plus a list of branches with open tasks. Useful at the start of a session.",
  remarks_get_pending:
    "Triage shortcut for one project: tasks in `to_do` or `acknowledged`, scoped to a project and optional branch.",
  remarks_get_all_pending:
    "Triage shortcut across everything you can see — personal annotations and every project, regardless of org.",
  remarks_acknowledge:
    "Mark a task as seen without committing to do it. Optionally leave a comment alongside the acknowledgement.",
  remarks_update_task_status:
    "Move a task between `acknowledged`, `doing`, `done`, and `rejected`. Rejecting requires a reason.",
  remarks_batch_update_status:
    "Apply the same status-update contract as `update_task_status` to up to 50 tasks in one call. Partial failures are reported per-task.",
  remarks_add_task_comment:
    "Post an agent-authored comment on a task. Use `kind` to mark it as a clarification request, progress update, or completion note.",
  remarks_dismiss:
    "Explicit rejection with a required reason (10–500 chars). Equivalent to `update_task_status(rejected)` but enforces the reason in the schema.",
  remarks_open_pr:
    "Signal that a set of tasks has been shipped on a branch. Returns `pending_github_integration` until the GitHub App is installed.",
};
