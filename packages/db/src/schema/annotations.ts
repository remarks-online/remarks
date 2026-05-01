import type { DomContextValue } from "@remarks/shared";
import { sql } from "drizzle-orm";
import { check, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { branches } from "./branches.js";
import { projects } from "./projects.js";
import { users } from "./users.js";

export const annotationStatusEnum = pgEnum("annotation_status", [
  "to_do",
  "doing",
  "done",
  "rejected",
  // Appended (matches `ALTER TYPE ADD VALUE` ordering in 0007); keep new values
  // at the end so the runtime enum order stays in sync with the DB.
  "acknowledged",
]);

export const annotationTargetTypeEnum = pgEnum("annotation_target_type", [
  "element",
  "rectangle",
  "route",
]);

// G1: action-shape classifier. Nullable on the row (default null).
export const annotationIntentEnum = pgEnum("annotation_intent", [
  "fix",
  "change",
  "question",
  "approve",
]);

// G2: triage-by-priority classifier. Nullable on the row (default null).
export const annotationSeverityEnum = pgEnum("annotation_severity", [
  "blocking",
  "important",
  "suggestion",
]);

export const annotations = pgTable(
  "annotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Null for personal (URL-keyed) annotations; set for project-scoped ones.
    // Paired with branchId via the project_branch_consistency check below.
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id),
    // Owner of the annotation. For personal annotations (projectId null) this
    // is also the only user who can read or mutate the row.
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    status: annotationStatusEnum("status").notNull().default("to_do"),
    targetType: annotationTargetTypeEnum("target_type").notNull(),
    // Triage classifiers (G1/G2). Both nullable; existing rows backfill as null.
    intent: annotationIntentEnum("intent"),
    severity: annotationSeverityEnum("severity"),

    url: text("url").notNull(),
    targetSelector: text("target_selector"),
    targetCoords: jsonb("target_coords").$type<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null>(),
    viewport: jsonb("viewport")
      .$type<{
        width: number;
        height: number;
        dpr: number;
      }>()
      .notNull(),
    domContext: jsonb("dom_context").$type<DomContextValue | null>(),
    frameworkHint: text("framework_hint"),

    commentText: text("comment_text").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectStatusIdx: index("annotations_project_status_idx").on(table.projectId, table.status),
    branchIdx: index("annotations_branch_idx").on(table.branchId),
    authorIdx: index("annotations_author_idx").on(table.authorId),
    createdAtIdx: index("annotations_created_at_idx").on(table.createdAt),
    authorUrlIdx: index("annotations_author_url_idx").on(table.authorId, table.url),
    projectBranchConsistency: check(
      "annotations_project_branch_consistency",
      sql`(${table.projectId} IS NULL AND ${table.branchId} IS NULL) OR (${table.projectId} IS NOT NULL AND ${table.branchId} IS NOT NULL)`
    ),
  })
);

export type Annotation = typeof annotations.$inferSelect;
export type NewAnnotation = typeof annotations.$inferInsert;
