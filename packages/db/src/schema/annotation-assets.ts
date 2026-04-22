import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { annotations } from "./annotations.js";

export const assetKindEnum = pgEnum("asset_kind", ["screenshot", "video", "dom_snapshot"]);

export const annotationAssets = pgTable("annotation_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  annotationId: uuid("annotation_id")
    .notNull()
    .references(() => annotations.id, { onDelete: "cascade" }),
  kind: assetKindEnum("kind").notNull(),
  r2Key: text("r2_key").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AnnotationAsset = typeof annotationAssets.$inferSelect;
export type NewAnnotationAsset = typeof annotationAssets.$inferInsert;
