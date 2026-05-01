import { sql } from "drizzle-orm";
import { check, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { annotations } from "./annotations.js";
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
  // Appended (matches `ALTER TYPE ADD VALUE` ordering); keep new values at the
  // end so the runtime enum order stays in sync with this list.
  "comment_edited",
  // G3: emitted by `agentUpdateAnnotationStatus` when the new status is
  // `acknowledged`. Other status transitions still emit `agent_updated_status`.
  "agent_acknowledged",
  // ADR-0018: emitted when a user reclassifies intent or severity. Payload is
  // `{ from, to }` where each is the classifier value or null for cleared.
  "intent_changed",
  "severity_changed",
]);

export const eventActorTypeEnum = pgEnum("event_actor_type", ["user", "agent", "system"]);

export const annotationEvents = pgTable(
  "annotation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // For 'user' and 'agent' actors, references the Clerk-mapped user. For
    // 'agent' the user is the Clerk identity that authorized the OAuth grant
    // the agent is using (see ADR-0015).
    actorId: uuid("actor_id").references(() => users.id),
    actorType: eventActorTypeEnum("actor_type").notNull().default("user"),
    // OAuth client name captured at DCR time, e.g. "Claude Code", "Cursor".
    // Only set when actor_type = 'agent'.
    actorOauthClientId: text("actor_oauth_client_id"),
    annotationId: uuid("annotation_id")
      .notNull()
      .references(() => annotations.id, { onDelete: "cascade" }),
    type: annotationEventTypeEnum("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    actorConsistency: check(
      "annotation_events_actor_consistency",
      sql`
        (${table.actorType} = 'user' AND ${table.actorId} IS NOT NULL AND ${table.actorOauthClientId} IS NULL) OR
        (${table.actorType} = 'agent' AND ${table.actorId} IS NOT NULL AND ${table.actorOauthClientId} IS NOT NULL) OR
        (${table.actorType} = 'system' AND ${table.actorId} IS NULL AND ${table.actorOauthClientId} IS NULL)
      `
    ),
  })
);

export type AnnotationEvent = typeof annotationEvents.$inferSelect;
export type NewAnnotationEvent = typeof annotationEvents.$inferInsert;
