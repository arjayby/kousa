CREATE TABLE "website" (
	"id" text PRIMARY KEY,
	"workspace_id" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "website_workspace_idx" ON "website" ("workspace_id");--> statement-breakpoint
ALTER TABLE "website" ADD CONSTRAINT "website_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;