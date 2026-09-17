CREATE TABLE "media_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"uploader_id" text,
	"sha256" text NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_asset_status" CHECK ("media_asset"."status" in ('pending', 'ready')),
	CONSTRAINT "media_asset_mime" CHECK ("media_asset"."mime_type" in ('image/png', 'image/jpeg', 'image/webp')),
	CONSTRAINT "media_asset_bytes" CHECK ("media_asset"."bytes" between 1 and 10485760),
	CONSTRAINT "media_asset_dimensions" CHECK ("media_asset"."width" > 0 and "media_asset"."height" > 0 and "media_asset"."width"::bigint * "media_asset"."height" <= 40000000),
	CONSTRAINT "media_asset_hash" CHECK ("media_asset"."sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_uploader_id_user_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_asset_project_hash_uidx" ON "media_asset" USING btree ("project_id","sha256");--> statement-breakpoint
CREATE INDEX "media_asset_project_status_idx" ON "media_asset" USING btree ("project_id","status");
--> statement-breakpoint
-- One statement/transaction works with Neon HTTP. The project lock serializes
-- quota reservations across users and server instances, including pending files.
CREATE FUNCTION reserve_media_asset(p_project uuid, p_actor text, p_hash text,
 p_name text, p_mime text, p_bytes integer, p_width integer, p_height integer)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE asset_id uuid;
BEGIN
 PERFORM 1 FROM project p WHERE p.id = p_project AND
  (p.owner_id = p_actor OR EXISTS (SELECT 1 FROM project_member m
   WHERE m.project_id = p.id AND m.user_id = p_actor AND m.role = 'editor'))
 FOR UPDATE;
 IF NOT FOUND THEN RETURN 'forbidden'; END IF;
 SELECT id INTO asset_id FROM media_asset WHERE project_id = p_project AND sha256 = p_hash;
 IF FOUND THEN RETURN asset_id::text; END IF;
 IF (SELECT count(*) >= 100 OR coalesce(sum(bytes), 0) + p_bytes > 104857600
     FROM media_asset WHERE project_id = p_project) THEN RETURN 'full'; END IF;
 INSERT INTO media_asset(project_id, uploader_id, sha256, name, mime_type, bytes, width, height)
 VALUES(p_project, p_actor, p_hash, p_name, p_mime, p_bytes, p_width, p_height)
 RETURNING id INTO asset_id;
 RETURN asset_id::text;
END;
$$;
