CREATE TABLE "project_canvas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"canvas" jsonb DEFAULT '{"version":1,"nodes":[],"edges":[]}'::jsonb NOT NULL,
	"canvas_revision" integer DEFAULT 0 NOT NULL,
	"canvas_updated_at" timestamp with time zone,
	"canvas_room_id" text,
	"canvas_seed" text,
	"canvas_ready" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_canvas_revision_nonnegative" CHECK ("project_canvas"."canvas_revision" >= 0),
	CONSTRAINT "project_canvas_name_length" CHECK (char_length(btrim("project_canvas"."name")) between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "project" DROP CONSTRAINT "project_canvas_revision_nonnegative";--> statement-breakpoint
ALTER TABLE "project_canvas" ADD CONSTRAINT "project_canvas_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_canvas_project_idx" ON "project_canvas" USING btree ("project_id","created_at");--> statement-breakpoint
-- Reuse IDs and room names to preserve existing URLs and offline recovery.
INSERT INTO project_canvas (id, project_id, name, canvas, canvas_revision, canvas_updated_at, canvas_room_id, canvas_seed, canvas_ready, created_at, updated_at)
SELECT id, id, 'Canvas 1', canvas, canvas_revision, canvas_updated_at, canvas_room_id, canvas_seed, canvas_ready, created_at, updated_at FROM project;
--> statement-breakpoint
DROP TRIGGER canvas_media_retention ON project;
--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "canvas";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "canvas_revision";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "canvas_updated_at";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "canvas_room_id";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "canvas_seed";--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "canvas_ready";
--> statement-breakpoint
-- New projects always have their first canvas, including projects from templates.
CREATE FUNCTION create_project_canvas() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO project_canvas (id, project_id, name) VALUES (NEW.id, NEW.id, 'Canvas 1');
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER project_default_canvas AFTER INSERT ON project FOR EACH ROW EXECUTE FUNCTION create_project_canvas();
--> statement-breakpoint
CREATE FUNCTION touch_canvas_project() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE project SET updated_at=now() WHERE id=NEW.project_id;
 RETURN NEW;
END $$;
--> statement-breakpoint
-- Lock the project before retention locks media rows, matching generation and cleanup.
CREATE TRIGGER a_canvas_touch_project BEFORE INSERT OR UPDATE ON project_canvas FOR EACH ROW EXECUTE FUNCTION touch_canvas_project();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION kousa_project_from_template(p_id uuid, p_user text, p_template uuid, p_hash text, p_name text, p_document jsonb)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE previous project;
BEGIN
 PERFORM 1 FROM "user" WHERE id=p_user FOR UPDATE;
 SELECT * INTO previous FROM project WHERE id=p_id;
 IF FOUND THEN
  IF previous.owner_id=p_user AND previous.template_request_hash=p_hash THEN RETURN 'EXISTING'; END IF;
  RETURN 'CONFLICT';
 END IF;
 -- Lock the snapshot against deletion until its new project is committed.
 PERFORM 1 FROM workflow_template WHERE id=p_template AND owner_id=p_user AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
 INSERT INTO project(id, name, owner_id, source_template_id, template_request_hash)
 VALUES(p_id, p_name, p_user, p_template, p_hash) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN 'CONFLICT'; END IF;
 UPDATE project_canvas SET canvas=p_document, canvas_updated_at=now() WHERE id=p_id;
 RETURN 'CREATED';
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION retain_record_media() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a media_asset; payload text; pid uuid;
BEGIN
 pid := (to_jsonb(NEW)->>('project_id'))::uuid;
 payload := to_jsonb(NEW)::text;
 FOR a IN SELECT * FROM media_asset WHERE project_id=pid AND position('"'||id::text||'"' in payload)>0 ORDER BY id FOR UPDATE LOOP
  IF a.status IN ('deleting','deleted') THEN RAISE EXCEPTION 'Media was removed; choose another file'; END IF;
  UPDATE media_asset SET retention_reason=coalesce(retention_reason,CASE WHEN TG_TABLE_NAME='project_canvas' THEN 'canvas' ELSE 'record' END) WHERE id=a.id;
 END LOOP;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE TRIGGER canvas_media_retention BEFORE INSERT OR UPDATE OF canvas ON project_canvas FOR EACH ROW EXECUTE FUNCTION retain_record_media();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION claim_media_removal(p_project uuid, p_asset uuid, p_actor text, p_abandoned boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE a media_asset;
BEGIN
 PERFORM 1 FROM project p WHERE p.id=p_project AND (p_actor IS NULL OR p.owner_id=p_actor OR EXISTS
 (SELECT 1 FROM project_member m WHERE m.project_id=p.id AND m.user_id=p_actor AND m.role='editor')) FOR UPDATE;
 IF NOT FOUND THEN RETURN 'forbidden'; END IF;
 SELECT * INTO a FROM media_asset WHERE id=p_asset AND project_id=p_project FOR UPDATE;
 IF NOT FOUND THEN RETURN 'missing'; END IF;
 IF a.status='deleted' THEN RETURN 'deleted'; END IF;
 IF a.status='deleting' THEN RETURN 'deleting'; END IF;
 IF a.status<>'ready' OR a.uploaded_at IS NULL OR a.retention_reason IS NOT NULL OR
 EXISTS(SELECT 1 FROM media_upload_write WHERE asset_id=p_asset) THEN RETURN 'retained'; END IF;
 IF p_abandoned AND a.uploaded_at > now()-interval '7 days' THEN RETURN 'recent'; END IF;
 -- Recheck all authoritative database references under the same lock used by retain/reserve.
 IF EXISTS(SELECT 1 FROM generation_run r WHERE r.project_id=p_project AND position('"'||p_asset::text||'"' in to_jsonb(r)::text)>0)
 OR EXISTS(SELECT 1 FROM graph_run r WHERE r.project_id=p_project AND position('"'||p_asset::text||'"' in r.plan::text)>0)
 OR EXISTS(SELECT 1 FROM clip_run r WHERE r.project_id=p_project AND position('"'||p_asset::text||'"' in to_jsonb(r)::text)>0)
 OR EXISTS(SELECT 1 FROM project_canvas p WHERE p.project_id=p_project AND position('"'||p_asset::text||'"' in p.canvas::text)>0)
 THEN RETURN 'retained'; END IF;
 UPDATE media_asset SET status='deleting', deletion_requested_at=now() WHERE id=p_asset;
 RETURN 'deleting';
END $$;
