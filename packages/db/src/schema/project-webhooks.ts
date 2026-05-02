import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { annotations } from "./annotations.js";
import { projects } from "./projects.js";

export const projectWebhooks = pgTable(
  "project_webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: text("events").array().notNull().default(sql`ARRAY[]::text[]`),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectActiveIdx: index("project_webhooks_project_active_idx")
      .on(table.projectId)
      .where(sql`${table.active} = true`),
  })
);

export const projectWebhookDeliveries = pgTable(
  "project_webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => projectWebhooks.id, { onDelete: "cascade" }),
    annotationId: uuid("annotation_id")
      .notNull()
      .references(() => annotations.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    attempt: smallint("attempt").notNull(),
    requestBodySize: integer("request_body_size").notNull(),
    responseStatus: smallint("response_status"),
    responseBodySnippet: text("response_body_snippet"),
    errorMessage: text("error_message"),
    succeeded: boolean("succeeded").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => ({
    webhookCreatedIdx: index("project_webhook_deliveries_webhook_created_idx").on(
      table.webhookId,
      table.createdAt
    ),
  })
);

export type ProjectWebhook = typeof projectWebhooks.$inferSelect;
export type NewProjectWebhook = typeof projectWebhooks.$inferInsert;
export type ProjectWebhookDelivery = typeof projectWebhookDeliveries.$inferSelect;
export type NewProjectWebhookDelivery = typeof projectWebhookDeliveries.$inferInsert;
