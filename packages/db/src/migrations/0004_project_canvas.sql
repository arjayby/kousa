ALTER TABLE "project" ADD COLUMN "canvas" jsonb DEFAULT '{"version":1,"nodes":[],"edges":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "canvas_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "canvas_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_canvas_revision_nonnegative" CHECK ("project"."canvas_revision" >= 0);