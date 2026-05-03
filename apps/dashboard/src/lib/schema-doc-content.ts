import type {
  AnnotationEventType,
  AnnotationIntent,
  AnnotationSeverity,
  AnnotationStatus,
  AnnotationTargetType,
  ReactComponentKind,
  WebhookEventType,
} from "@remarks/shared";

// Pure data backing the /app/docs/schema page. Kept JSX-free so the section
// components stay thin and so the typed Records below give us a compile-time
// guardrail: drop a value from `AnnotationIntent` (or any other canonical
// union) and this file fails to type-check, forcing the doc to be updated.

export const INTENT_DESCRIPTIONS: Record<AnnotationIntent, string> = {
  fix: "Something is broken or wrong — please correct it.",
  change: "Works as designed, but a different behavior or design is desired.",
  question: "Asking for clarification on what this does or why.",
  approve: "Looks right; signing off.",
};

export const SEVERITY_DESCRIPTIONS: Record<AnnotationSeverity, string> = {
  blocking: "Cannot ship while this exists. Highest priority.",
  important: "Should be fixed soon; not release-blocking but shouldn't linger.",
  suggestion: "Nice-to-have. Address when scope allows.",
};

export const STATUS_DESCRIPTIONS: Record<AnnotationStatus, string> = {
  to_do: "Captured and unclaimed. The default state at creation.",
  doing: "Someone or some agent is actively working on this.",
  acknowledged: "An agent has read the task and signalled receipt, but hasn't started work yet.",
  done: "Work is complete.",
  rejected:
    "Closed without action. A reason is required and stored on the status_changed event payload.",
};

export const TARGET_TYPE_DESCRIPTIONS: Record<AnnotationTargetType, string> = {
  element:
    "A specific DOM element. The selector lives on `targetSelector`; `domContext` carries the captured tag, classes, ancestors, and React component chain.",
  rectangle:
    "A free-drawn region of the page. Coordinates live on `targetCoords` (x/y/width/height in CSS pixels).",
  route:
    "A whole route or page — no element or region pin. Useful for top-level feedback like 'this entire flow feels off'.",
};

export const REACT_COMPONENT_KIND_DESCRIPTIONS: Record<ReactComponentKind, string> = {
  function: "A function component (the common case).",
  class: "A class component.",
  forward_ref: "A `React.forwardRef` wrapper.",
  memo: "A `React.memo` wrapper.",
  lazy: "A `React.lazy` wrapper.",
  provider: "A context provider.",
  context: "A context consumer.",
  other:
    "Anything that didn't match a known kind — typically a host primitive or unrecognized wrapper.",
};

export interface FieldRow {
  name: string;
  type: string;
  nullable: boolean;
  description: string;
}

export interface FieldGroup {
  title: string;
  description?: string;
  fields: FieldRow[];
}

export const ANNOTATION_FIELD_GROUPS: FieldGroup[] = [
  {
    title: "Identity",
    fields: [
      { name: "id", type: "uuid", nullable: false, description: "The annotation's unique id." },
      {
        name: "projectId",
        type: "uuid",
        nullable: true,
        description:
          "Project the annotation belongs to. Null for personal (URL-keyed, owner-private) annotations.",
      },
      {
        name: "projectSlug",
        type: "string",
        nullable: true,
        description: "Project slug; mirrors `projectId`. Useful when listing across projects.",
      },
      {
        name: "branchId",
        type: "uuid",
        nullable: true,
        description: "Branch the annotation was captured against. Null for personal annotations.",
      },
      {
        name: "branchName",
        type: "string",
        nullable: true,
        description: "Human-readable branch name (e.g., 'main', 'feat/foo').",
      },
    ],
  },
  {
    title: "Classification",
    description:
      "The triage axes. Status is required; intent and severity are optional and default to null ('uncategorized').",
    fields: [
      {
        name: "status",
        type: "AnnotationStatus",
        nullable: false,
        description: "Lifecycle state. See the Enums section.",
      },
      {
        name: "intent",
        type: "AnnotationIntent",
        nullable: true,
        description: "What the author wants done (fix / change / question / approve).",
      },
      {
        name: "severity",
        type: "AnnotationSeverity",
        nullable: true,
        description: "Triage priority (blocking / important / suggestion).",
      },
      {
        name: "targetType",
        type: "AnnotationTargetType",
        nullable: false,
        description: "Element, rectangle, or route. Determines which target field is populated.",
      },
    ],
  },
  {
    title: "Content",
    fields: [
      {
        name: "url",
        type: "url",
        nullable: false,
        description: "URL the annotation was captured on.",
      },
      {
        name: "targetSelector",
        type: "string",
        nullable: true,
        description: "CSS selector for element annotations. Null for rectangle and route.",
      },
      {
        name: "targetCoords",
        type: "{ x, y, width, height }",
        nullable: true,
        description: "Bounding rect for rectangle annotations. Null otherwise.",
      },
      {
        name: "viewport",
        type: "{ width, height, dpr }",
        nullable: false,
        description: "Viewport at capture time, including device-pixel ratio.",
      },
      {
        name: "commentText",
        type: "string",
        nullable: false,
        description: "The author's comment. 1–5,000 characters.",
      },
    ],
  },
  {
    title: "Context",
    fields: [
      {
        name: "domContext",
        type: "DomContext",
        nullable: true,
        description:
          "Captured DOM snapshot. See the DOM context section for fields. Null for rectangle and route, or when an annotation predates DOM capture.",
      },
      {
        name: "frameworkHint",
        type: "string",
        nullable: true,
        description:
          "Free-form framework tag set by the capture pipeline ('react' today). Null when no framework was detected.",
      },
    ],
  },
  {
    title: "Metadata",
    fields: [
      {
        name: "author",
        type: "{ id, name, email, avatarUrl }",
        nullable: false,
        description: "User who created the annotation. Email may be null if the user was deleted.",
      },
      {
        name: "assets",
        type: "Asset[]",
        nullable: false,
        description:
          "Attached files (screenshot, video, dom_snapshot). Each has `id`, `kind`, `url`, `contentType`. May be an empty array.",
      },
      {
        name: "createdAt",
        type: "ISO 8601 datetime",
        nullable: false,
        description: "Created timestamp.",
      },
      {
        name: "updatedAt",
        type: "ISO 8601 datetime",
        nullable: false,
        description: "Last-modified timestamp.",
      },
    ],
  },
];

export const DOM_CONTEXT_FIELDS: FieldRow[] = [
  {
    name: "tagName",
    type: "string",
    nullable: true,
    description: "The element's tag (lowercased), e.g. 'button'.",
  },
  {
    name: "classes",
    type: "string[]",
    nullable: true,
    description: "CSS class list captured at click time.",
  },
  {
    name: "textContent",
    type: "string",
    nullable: true,
    description: "Truncated visible text content (max 500 chars).",
  },
  {
    name: "computedStyles",
    type: "Record<string, string>",
    nullable: true,
    description:
      "Selected computed CSS values (font, color, padding, margin, background-color). Best-effort; exact key set depends on the picker config.",
  },
  {
    name: "ancestors",
    type: "Array<{ tagName, classes }>",
    nullable: true,
    description: "Leaf-to-root chain of ancestor tags + classes. Used to disambiguate selectors.",
  },
  {
    name: "reactComponents",
    type: "ReactComponentNode[]",
    nullable: true,
    description:
      "Leaf-to-root React component chain (max 12 entries). See the section below. Empty / null on non-React pages or when React was minified beyond recognition.",
  },
];

export interface EventTypeRow {
  type: AnnotationEventType;
  description: string;
  payload: string;
}

export interface EventGroup {
  title: string;
  description: string;
  events: EventTypeRow[];
}

export const ANNOTATION_EVENT_GROUPS: EventGroup[] = [
  {
    title: "Lifecycle",
    description: "Core state transitions every consumer should handle.",
    events: [
      { type: "created", description: "A new annotation was captured.", payload: "{} (empty)" },
      {
        type: "status_changed",
        description: "Status moved between values (user-driven).",
        payload: "{ from: AnnotationStatus, to: AnnotationStatus, reason?: string }",
      },
      {
        type: "agent_updated_status",
        description: "An agent moved status (any value other than `acknowledged`).",
        payload: "{ from: AnnotationStatus, to: AnnotationStatus, reason?: string }",
      },
      {
        type: "agent_acknowledged",
        description:
          "An agent transitioned to `acknowledged`. Distinct from agent_updated_status so the dashboard can render a compact pill.",
        payload: "{} (empty)",
      },
      {
        type: "resolved",
        description: "Annotation transitioned to `done`. Internal companion to status_changed.",
        payload: "{} (empty)",
      },
    ],
  },
  {
    title: "Commentary",
    description: "Human and agent conversation on an annotation.",
    events: [
      {
        type: "comment_added",
        description: "A user posted a comment.",
        payload: "{ comment: string }",
      },
      {
        type: "agent_commented",
        description: "An agent posted a comment.",
        payload: "{ comment: string, kind?: string }",
      },
      {
        type: "comment_edited",
        description: "An existing comment was edited.",
        payload: "{ comment: string }",
      },
    ],
  },
  {
    title: "Reclassification",
    description: "Triage axes can be changed after capture.",
    events: [
      {
        type: "intent_changed",
        description: "Intent was reclassified by a user.",
        payload: "{ from: AnnotationIntent | null, to: AnnotationIntent | null }",
      },
      {
        type: "severity_changed",
        description: "Severity was reclassified by a user.",
        payload: "{ from: AnnotationSeverity | null, to: AnnotationSeverity | null }",
      },
    ],
  },
  {
    title: "Bookkeeping",
    description: "Side-effect events emitted by the pipeline.",
    events: [
      {
        type: "assigned",
        description: "An annotation was assigned to a user.",
        payload: "{ assigneeId: uuid }",
      },
      {
        type: "pr_linked",
        description: "A pull request was linked to the annotation.",
        payload: "{ url: string, title?: string }",
      },
      {
        type: "asset_attached",
        description: "A new asset (screenshot / video / DOM snapshot) was attached.",
        payload: "{ assetId: uuid, kind: AssetKind }",
      },
    ],
  },
];

export const EVENT_ACTOR_NOTE =
  "Every event also carries actor context — `actorType` (user / agent / system), `actorId` (the internal user id, null for system), and `actorOauthClientId` (only set when actorType is 'agent'; identifies the OAuth client by name, e.g. 'Claude Code').";

export const WEBHOOK_EVENT_DESCRIPTIONS: Record<WebhookEventType, string> = {
  "annotation.created": "A new annotation was captured for the project.",
  "annotation.status_changed":
    "An annotation's status moved to a new value. Includes both user and agent transitions.",
  "annotation.comment_added": "A comment was posted by either a user or an agent.",
  "annotation.resolved":
    "An annotation transitioned to `done`. Synthetic — fires alongside the matching annotation.status_changed.",
};

// Real-world example: a `created` event for a personal annotation. Comments
// (`//`) are illustrative; receivers should parse strict JSON.
export const SSE_EXAMPLE = `id: 2026-05-02T18:14:32.041Z:7c1e9b0c-2f8a-4d2c-9b21-3a85a51d6a01
event: annotation_event
data: {
  "id": "2026-05-02T18:14:32.041Z:7c1e9b0c-2f8a-4d2c-9b21-3a85a51d6a01",
  "type": "created",
  "annotationId": "8ab2c7f1-4e0b-4a39-9f2a-1c0a0a4d1e22",
  "projectId": "1f3e8c10-9a2c-4b3a-9e7e-7c1d4c00a912",
  "authorId": "9e2f3a44-1b27-4cda-83c6-77b4cf9c29a1",
  "actorType": "user",
  "actorId": "9e2f3a44-1b27-4cda-83c6-77b4cf9c29a1",
  "actorOauthClientId": null,
  "payload": {},
  "createdAt": "2026-05-02T18:14:32.041Z"
}
`;

export const WEBHOOK_BODY_EXAMPLE = `{
  "version": "1",
  "type": "annotation.created",
  "occurredAt": "2026-05-02T18:14:32.041Z",
  "data": {
    // The same payload object that would land on the SSE event for this transition.
  }
}`;

export const WEBHOOK_HEADERS_EXAMPLE = `Content-Type: application/json
User-Agent: Remarks-Webhooks/1.0
Remarks-Event: annotation.created
Remarks-Delivery-Id: 0f9c2b8e-1ab3-4d6e-9b1c-22a48f1c3d12
Remarks-Signature: t=1746210872,v1=8e3d1c9a8b...`;
