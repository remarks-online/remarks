import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations.js";
import { users } from "./users.js";

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Null for personal projects (creator-owned, no org). Set for org-scoped projects.
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    creatorUserId: uuid("creator_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    gitRepoUrl: text("git_repo_url"),
    primaryBranch: text("primary_branch").notNull().default("main"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgSlugIdx: uniqueIndex("projects_org_slug_idx")
      .on(table.orgId, table.slug)
      .where(sql`${table.orgId} IS NOT NULL`),
    creatorSlugIdx: uniqueIndex("projects_creator_slug_idx")
      .on(table.creatorUserId, table.slug)
      .where(sql`${table.orgId} IS NULL`),
  })
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
