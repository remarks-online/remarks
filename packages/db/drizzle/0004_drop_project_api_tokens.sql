ALTER TABLE "annotation_events" DROP CONSTRAINT "annotation_events_actor_token_id_project_api_tokens_id_fk";--> statement-breakpoint
ALTER TABLE "annotation_events" DROP CONSTRAINT "annotation_events_actor_consistency";--> statement-breakpoint
ALTER TABLE "annotation_events" ADD COLUMN "actor_oauth_client_id" text;--> statement-breakpoint
ALTER TABLE "annotation_events" DROP COLUMN "actor_token_id";--> statement-breakpoint
DROP TABLE "project_api_tokens";--> statement-breakpoint
ALTER TABLE "annotation_events" ADD CONSTRAINT "annotation_events_actor_consistency" CHECK (
        ("annotation_events"."actor_type" = 'user' AND "annotation_events"."actor_id" IS NOT NULL AND "annotation_events"."actor_oauth_client_id" IS NULL) OR
        ("annotation_events"."actor_type" = 'agent' AND "annotation_events"."actor_id" IS NOT NULL AND "annotation_events"."actor_oauth_client_id" IS NOT NULL) OR
        ("annotation_events"."actor_type" = 'system' AND "annotation_events"."actor_id" IS NULL AND "annotation_events"."actor_oauth_client_id" IS NULL)
      );
