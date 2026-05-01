CREATE TYPE "public"."annotation_intent" AS ENUM('fix', 'change', 'question', 'approve');--> statement-breakpoint
CREATE TYPE "public"."annotation_severity" AS ENUM('blocking', 'important', 'suggestion');--> statement-breakpoint
ALTER TYPE "public"."annotation_event_type" ADD VALUE 'agent_acknowledged';--> statement-breakpoint
ALTER TYPE "public"."annotation_status" ADD VALUE 'acknowledged';--> statement-breakpoint
ALTER TABLE "annotations" ADD COLUMN "intent" "annotation_intent";--> statement-breakpoint
ALTER TABLE "annotations" ADD COLUMN "severity" "annotation_severity";