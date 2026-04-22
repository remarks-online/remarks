export const MAX_SCREENSHOT_BYTES = 50_000_000;
export const MAX_COMMENT_LENGTH = 5000;
export const MAX_SELECTOR_LENGTH = 2000;
export const MAX_TEXT_CONTENT_LENGTH = 500;
export const MAX_BRANCH_NAME_LENGTH = 255;
export const MAX_PROJECT_NAME_LENGTH = 100;
export const MAX_PROJECT_SLUG_LENGTH = 50;

export const PROJECT_SLUG_REGEX = /^[a-z0-9-]+$/;

export const ANNOTATION_STATUSES = ["to_do", "doing", "done", "rejected"] as const;
export const ANNOTATION_TARGET_TYPES = ["element", "rectangle", "route"] as const;
export const ASSET_KINDS = ["screenshot", "video", "dom_snapshot"] as const;
export const PROJECT_ROLES = ["admin", "editor", "viewer"] as const;

export type AnnotationStatus = (typeof ANNOTATION_STATUSES)[number];
export type AnnotationTargetType = (typeof ANNOTATION_TARGET_TYPES)[number];
export type AssetKind = (typeof ASSET_KINDS)[number];
export type ProjectRole = (typeof PROJECT_ROLES)[number];
