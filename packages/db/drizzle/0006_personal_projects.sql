-- Drop the old all-projects unique slug index; replace with two partial
-- indexes (one per scope) below.
DROP INDEX "projects_org_slug_idx";--> statement-breakpoint

-- Allow personal projects: org_id becomes optional.
ALTER TABLE "projects" ALTER COLUMN "org_id" DROP NOT NULL;--> statement-breakpoint

-- Add creator_user_id as nullable so we can backfill before clamping NOT NULL.
ALTER TABLE "projects" ADD COLUMN "creator_user_id" uuid;--> statement-breakpoint

-- Backfill from project_members: use the earliest-created admin row as the
-- canonical creator. createProject() has always inserted exactly one admin
-- row (the creator) before fanning out org members, so this picks the right
-- user even when org members were later promoted to admin.
UPDATE "projects" SET "creator_user_id" = (
  SELECT "user_id"
  FROM "project_members"
  WHERE "project_id" = "projects"."id" AND "role" = 'admin'
  ORDER BY "created_at" ASC, "user_id" ASC
  LIMIT 1
);--> statement-breakpoint

-- Any project without an admin row would block this; fail loudly at deploy
-- time rather than silently leaving NULLs.
ALTER TABLE "projects" ALTER COLUMN "creator_user_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "projects" ADD CONSTRAINT "projects_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "projects_creator_slug_idx" ON "projects" USING btree ("creator_user_id","slug") WHERE "projects"."org_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_org_slug_idx" ON "projects" USING btree ("org_id","slug") WHERE "projects"."org_id" IS NOT NULL;
