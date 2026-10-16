CREATE TABLE "membership" (
	"workspace_id" text,
	"user_id" text,
	"role" text NOT NULL,
	CONSTRAINT "membership_pkey" PRIMARY KEY("workspace_id","user_id"),
	CONSTRAINT "membership_role_check" CHECK ("role" IN ('admin', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "membership_user_idx" ON "membership" ("user_id");--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_workspace_id_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT;