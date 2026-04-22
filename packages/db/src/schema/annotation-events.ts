import { sql } from "drizzle-orm";
import { check, jsonb, pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { annotations } from "./annotations.js";
import { projectApiTokens } from "./project-api-tokens.js";
import { users } from "./users.js";

export const annotationEventTypeEnum = pgEnum("annotation_event_type", [
  "created",
  "status_changed",
  "comment_added",
  "assigned",
  "pr_linked",
  "asset_attached",
  "resolved",
  "agent_updated_status",
  "agent_commented",
]);

export const eventActorTypeEnum = pgEnum("event_actor_type", ["user", "agent", "system"]);

export const annotationEvents = pgTable(
  "annotation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    annotationId: uuid("annotation_id")
      .notNull()
      .references(() => annotations.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id), // null when actor_type is 'agent' or 'system'
    actorType: eventActorTypeEnum("actor_type").notNull().default("user"),
    actorTokenId: uuid("actor_token_id").references(() => projectApiTokens.id),
    type: annotationEventTypeEnum("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    actorConsistency: check(
      "annotation_events_actor_consistency",
      sql`
        (${table.actorType} = 'user' AND ${table.actorId} IS NOT NULL AND ${table.actorTokenId} IS NULL) OR
        (${table.actorType} = 'agent' AND ${table.actorId} IS NULL AND ${table.actorTokenId} IS NOT NULL) OR
        (${table.actorType} = 'system' AND ${table.actorId} IS NULL AND ${table.actorTokenId} IS NULL)
      `
    ),
  })
);

export type AnnotationEvent = typeof annotationEvents.$inferSelect;
export type NewAnnotationEvent = typeof annotationEvents.$inferInsert;
