export const MAX_SCREENSHOT_BYTES = 50_000_000;
export const MAX_COMMENT_LENGTH = 5000;
export const MAX_SELECTOR_LENGTH = 2000;
export const MAX_TEXT_CONTENT_LENGTH = 500;
export const MAX_BRANCH_NAME_LENGTH = 255;
export const MAX_PROJECT_NAME_LENGTH = 100;
export const MAX_PROJECT_SLUG_LENGTH = 50;

// G4: a `reason` is required whenever an annotation transitions to
// `rejected`. Min length discourages lazy "no" responses; max keeps the
// JSONB payload reasonable. Both bounds are post-trim.
export const MIN_REJECTION_REASON_LENGTH = 10;
export const MAX_REJECTION_REASON_LENGTH = 500;

// G13: cap on the leaf-to-root React component chain captured for an element.
// 12 covers virtually all real component depths while bounding the JSONB payload.
export const MAX_REACT_COMPONENTS = 12;
export const MAX_REACT_COMPONENT_NAME_LENGTH = 120;
export const MAX_REACT_SOURCE_PATH_LENGTH = 500;

export const PROJECT_SLUG_REGEX = /^[a-z0-9-]+$/;

// `acknowledged` lives between `to_do` and `doing`: an agent has read the task
// and signalled receipt, but hasn't started work. Appended last to match the
// `ALTER TYPE ADD VALUE` ordering applied in migration 0007 — keep new values
// at the tail so the runtime order stays in sync with the DB.
export const ANNOTATION_STATUSES = ["to_do", "doing", "done", "rejected", "acknowledged"] as const;
export const ANNOTATION_TARGET_TYPES = ["element", "rectangle", "route"] as const;
export const ASSET_KINDS = ["screenshot", "video", "dom_snapshot"] as const;
export const PROJECT_ROLES = ["admin", "editor", "viewer"] as const;

// Triage-by-priority axis (G2). Nullable on annotations: callers can omit if
// they don't have a strong opinion. The dashboard sorts blocking → suggestion.
export const ANNOTATION_SEVERITIES = ["blocking", "important", "suggestion"] as const;

// Action-shape axis (G1). Lets agents distinguish "please fix this" from
// "I'm asking a question" without parsing the comment.
export const ANNOTATION_INTENTS = ["fix", "change", "question", "approve"] as const;

export type AnnotationStatus = (typeof ANNOTATION_STATUSES)[number];
export type AnnotationTargetType = (typeof ANNOTATION_TARGET_TYPES)[number];
export type AnnotationSeverity = (typeof ANNOTATION_SEVERITIES)[number];
export type AnnotationIntent = (typeof ANNOTATION_INTENTS)[number];
export type AssetKind = (typeof ASSET_KINDS)[number];
export type ProjectRole = (typeof PROJECT_ROLES)[number];

// Statuses that count as "open" (not yet resolved or dismissed). Used by the
// `get_project_context` open-task counter so agents see all in-flight work,
// including tasks they've already acknowledged.
export const OPEN_ANNOTATION_STATUSES = ["to_do", "doing", "acknowledged"] as const;
