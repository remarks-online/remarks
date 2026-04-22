CREATE TYPE "public"."event_actor_type" AS ENUM('user', 'agent', 'system');--> statement-breakpoint
ALTER TYPE "public"."annotation_event_type" ADD VALUE 'agent_updated_status';--> statement-breakpoint
ALTER TYPE "public"."annotation_event_type" ADD VALUE 'agent_commented';--> statement-breakpoint
CREATE TABLE "project_api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"token_last_4" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"client_info" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT "projects_api_token_unique";--> statement-breakpoint
ALTER TABLE "annotation_events" ADD COLUMN "actor_type" "event_actor_type" DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "annotation_events" ADD COLUMN "actor_token_id" uuid;--> statement-breakpoint
ALTER TABLE "project_api_tokens" ADD CONSTRAINT "project_api_tokens_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_api_tokens" ADD CONSTRAINT "project_api_tokens_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_api_tokens_project_idx" ON "project_api_tokens" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_api_tokens_last_used_idx" ON "project_api_tokens" USING btree ("last_used_at");--> statement-breakpoint
ALTER TABLE "annotation_events" ADD CONSTRAINT "annotation_events_actor_token_id_project_api_tokens_id_fk" FOREIGN KEY ("actor_token_id") REFERENCES "public"."project_api_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "api_token";--> statement-breakpoint
ALTER TABLE "annotation_events" ADD CONSTRAINT "annotation_events_actor_consistency" CHECK (
        ("annotation_events"."actor_type" = 'user' AND "annotation_events"."actor_id" IS NOT NULL AND "annotation_events"."actor_token_id" IS NULL) OR
        ("annotation_events"."actor_type" = 'agent' AND "annotation_events"."actor_id" IS NULL AND "annotation_events"."actor_token_id" IS NOT NULL) OR
        ("annotation_events"."actor_type" = 'system' AND "annotation_events"."actor_id" IS NULL AND "annotation_events"."actor_token_id" IS NULL)
      );