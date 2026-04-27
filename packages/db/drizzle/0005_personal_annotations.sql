ALTER TABLE "annotations" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "annotations" ALTER COLUMN "branch_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "annotations_author_url_idx" ON "annotations" USING btree ("author_id","url");--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_project_branch_consistency" CHECK (("annotations"."project_id" IS NULL AND "annotations"."branch_id" IS NULL) OR ("annotations"."project_id" IS NOT NULL AND "annotations"."branch_id" IS NOT NULL));