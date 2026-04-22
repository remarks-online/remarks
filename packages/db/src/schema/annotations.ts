import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { branches } from "./branches.js";
import { projects } from "./projects.js";
import { users } from "./users.js";

export const annotationStatusEnum = pgEnum("annotation_status", [
  "to_do",
  "doing",
  "done",
  "rejected",
]);

export const annotationTargetTypeEnum = pgEnum("annotation_target_type", [
  "element",
  "rectangle",
  "route",
]);

export const annotations = pgTable(
  "annotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    status: annotationStatusEnum("status").notNull().default("to_do"),
    targetType: annotationTargetTypeEnum("target_type").notNull(),

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
    domContext: jsonb("dom_context").$type<{
      tagName?: string;
      classes?: string[];
      textContent?: string;
      computedStyles?: Record<string, string>;
      ancestors?: Array<{ tagName: string; classes?: string[] }>;
    } | null>(),
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
  })
);

export type Annotation = typeof annotations.$inferSelect;
export type NewAnnotation = typeof annotations.$inferInsert;
