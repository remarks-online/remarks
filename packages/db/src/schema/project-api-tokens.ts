import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects.js";
import { users } from "./users.js";

export const projectApiTokens = pgTable(
  "project_api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    tokenPrefix: text("token_prefix").notNull(),
    tokenLast4: text("token_last_4").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    clientInfo: jsonb("client_info").$type<{
      agent?: string;
      version?: string;
      os?: string;
    } | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectIdx: index("project_api_tokens_project_idx").on(table.projectId),
    lastUsedIdx: index("project_api_tokens_last_used_idx").on(table.lastUsedAt),
  })
);

export type ProjectApiToken = typeof projectApiTokens.$inferSelect;
export type NewProjectApiToken = typeof projectApiTokens.$inferInsert;
