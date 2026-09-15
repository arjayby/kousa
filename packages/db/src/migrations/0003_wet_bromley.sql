ALTER TABLE "project_invite" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "project_invite" ADD COLUMN "expires_in_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_invite" ADD COLUMN "delivery_status" text DEFAULT 'sending' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_invite" ADD COLUMN "delivery_attempted_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "project_invite" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_invite" ADD COLUMN "delivery_error" text;--> statement-breakpoint
ALTER TABLE "project_invite" ADD COLUMN "message_id" text;--> statement-breakpoint
-- Existing unaddressed links must never remain claimable after this change.
UPDATE "project_invite" SET "revoked_at" = COALESCE("revoked_at", now()), "delivery_status" = 'failed', "delivery_error" = 'legacy'
WHERE "email" IS NULL AND "accepted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "project_invite_project_email_uidx" ON "project_invite" USING btree ("project_id","email");--> statement-breakpoint
ALTER TABLE "project_invite" ADD CONSTRAINT "project_invite_email_required" CHECK ("project_invite"."email" is not null or "project_invite"."revoked_at" is not null or "project_invite"."accepted_at" is not null);--> statement-breakpoint
ALTER TABLE "project_invite" ADD CONSTRAINT "project_invite_email_normalized" CHECK ("project_invite"."email" = lower(btrim("project_invite"."email")));--> statement-breakpoint
ALTER TABLE "project_invite" ADD CONSTRAINT "project_invite_expiry_days" CHECK ("project_invite"."expires_in_days" in (1, 7, 30));--> statement-breakpoint
ALTER TABLE "project_invite" ADD CONSTRAINT "project_invite_delivery_status" CHECK ("project_invite"."delivery_status" in ('sending', 'sent', 'failed'));