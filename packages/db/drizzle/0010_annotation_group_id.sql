ALTER TABLE "annotations" ADD COLUMN "group_id" uuid;--> statement-breakpoint
CREATE INDEX "annotations_group_id_idx" ON "annotations" USING btree ("group_id");