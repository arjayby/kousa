CREATE TABLE "invitation" (
	"id" text PRIMARY KEY,
	"workspace_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL UNIQUE,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_role_check" CHECK ("role" IN ('admin', 'viewer')),
	CONSTRAINT "invitation_status_check" CHECK ("status" IN ('pending', 'accepted', 'revoked')),
	CONSTRAINT "invitation_email_check" CHECK ("email" = lower("email"))
);
--> statement-breakpoint
CREATE INDEX "invitation_workspace_idx" ON "invitation" ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_pending_email_idx" ON "invitation" ("workspace_id","email") WHERE "status" = 'pending';--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;