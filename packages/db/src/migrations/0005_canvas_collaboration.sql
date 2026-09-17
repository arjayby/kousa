ALTER TABLE "project" ADD COLUMN "canvas_room_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "canvas_seed" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "canvas_ready" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "collaboration_lock_id" uuid;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "collaboration_lock_until" timestamp with time zone;