ALTER TABLE "website" ADD COLUMN "name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "website" ADD COLUMN "hostname" text NOT NULL;--> statement-breakpoint
ALTER TABLE "website" ADD COLUMN "public_tracking_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "website" ADD CONSTRAINT "website_public_tracking_id_key" UNIQUE("public_tracking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "website_workspace_hostname_idx" ON "website" ("workspace_id","hostname");