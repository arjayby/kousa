-- Existing files may exist in offline drafts or another browser's undo stack.
-- Preserve them indefinitely; only new, explicit library-only uploads are candidates.
ALTER TABLE media_asset ADD COLUMN retention_reason text DEFAULT 'legacy';
--> statement-breakpoint
ALTER TABLE media_asset ADD COLUMN uploaded_at timestamptz;
--> statement-breakpoint
ALTER TABLE media_asset ADD COLUMN deletion_requested_at timestamptz;
--> statement-breakpoint
ALTER TABLE media_asset DROP CONSTRAINT media_asset_status;
--> statement-breakpoint
ALTER TABLE media_asset ADD CONSTRAINT media_asset_status CHECK (status IN ('pending','ready','deleting','deleted'));
--> statement-breakpoint
DROP INDEX media_asset_project_hash_uidx;
--> statement-breakpoint
CREATE UNIQUE INDEX media_asset_project_hash_uidx ON media_asset(project_id, sha256) WHERE status <> 'deleted';
--> statement-breakpoint
CREATE TABLE media_upload_write (
 id uuid PRIMARY KEY, asset_id uuid NOT NULL REFERENCES media_asset(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX media_upload_write_asset_idx ON media_upload_write(asset_id);
--> statement-breakpoint
CREATE FUNCTION reserve_media_asset_lifecycle(p_project uuid, p_actor text, p_hash text,
 p_name text, p_mime text, p_bytes integer, p_width integer, p_height integer, p_duration integer,
 p_retention text, p_write uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE a media_asset;
BEGIN
 PERFORM 1 FROM project p WHERE p.id=p_project AND (p.owner_id=p_actor OR EXISTS
 (SELECT 1 FROM project_member m WHERE m.project_id=p.id AND m.user_id=p_actor AND m.role='editor')) FOR UPDATE;
 IF NOT FOUND THEN RETURN 'forbidden'; END IF;
 SELECT * INTO a FROM media_asset WHERE project_id=p_project AND sha256=p_hash AND status <> 'deleted' FOR UPDATE;
 IF FOUND THEN
  IF a.status='deleting' THEN RETURN 'deleting'; END IF;
  UPDATE media_asset SET retention_reason=coalesce(retention_reason,p_retention),
   uploaded_at=CASE WHEN uploaded_at IS NOT NULL THEN now() ELSE NULL END WHERE id=a.id;
 ELSE
  IF (SELECT count(*) >= 100 OR coalesce(sum(bytes),0)+p_bytes > 104857600
   FROM media_asset WHERE project_id=p_project AND status <> 'deleted') THEN RETURN 'full'; END IF;
  INSERT INTO media_asset(project_id,uploader_id,sha256,name,mime_type,bytes,width,height,duration_ms,retention_reason)
  VALUES(p_project,p_actor,p_hash,p_name,p_mime,p_bytes,p_width,p_height,p_duration,p_retention) RETURNING * INTO a;
 END IF;
 -- A crashed/ambiguous write stays protected. General interrupted-upload recovery is separate.
 IF p_write IS NOT NULL THEN INSERT INTO media_upload_write(id,asset_id) VALUES(p_write,a.id); END IF;
 RETURN a.id::text;
END $$;
--> statement-breakpoint
-- Older servers and workers retain any media they expose for attachment.
CREATE OR REPLACE FUNCTION reserve_media_asset(p_project uuid, p_actor text, p_hash text,
 p_name text, p_mime text, p_bytes integer, p_width integer, p_height integer, p_duration integer DEFAULT NULL)
RETURNS text LANGUAGE sql AS $$ SELECT reserve_media_asset_lifecycle(p_project,p_actor,p_hash,p_name,p_mime,p_bytes,p_width,p_height,p_duration,'legacy',NULL) $$;
--> statement-breakpoint
CREATE FUNCTION retain_media_asset(p_project uuid, p_actor text, p_asset uuid)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM project p WHERE p.id=p_project AND (p.owner_id=p_actor OR EXISTS
 (SELECT 1 FROM project_member m WHERE m.project_id=p.id AND m.user_id=p_actor AND m.role='editor')) FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE media_asset SET retention_reason=coalesce(retention_reason,'canvas')
 WHERE project_id=p_project AND id=p_asset AND status='ready';
 RETURN FOUND;
END $$;
--> statement-breakpoint
-- Retained records pin both results and JSON inputs, even after jobs finish or nodes disappear.
CREATE FUNCTION retain_record_media() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a media_asset; payload text; pid uuid;
BEGIN
 pid := (to_jsonb(NEW)->>(CASE WHEN TG_TABLE_NAME='project' THEN 'id' ELSE 'project_id' END))::uuid;
 payload := to_jsonb(NEW)::text;
 FOR a IN SELECT * FROM media_asset WHERE project_id=pid AND position('"'||id::text||'"' in payload)>0 ORDER BY id FOR UPDATE LOOP
  IF a.status IN ('deleting','deleted') THEN RAISE EXCEPTION 'Media was removed; choose another file'; END IF;
  UPDATE media_asset SET retention_reason=coalesce(retention_reason,CASE WHEN TG_TABLE_NAME='project' THEN 'canvas' ELSE 'record' END) WHERE id=a.id;
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER generation_media_retention BEFORE INSERT OR UPDATE ON generation_run FOR EACH ROW EXECUTE FUNCTION retain_record_media();
--> statement-breakpoint
CREATE TRIGGER graph_media_retention BEFORE INSERT OR UPDATE ON graph_run FOR EACH ROW EXECUTE FUNCTION retain_record_media();
--> statement-breakpoint
CREATE TRIGGER clip_media_retention BEFORE INSERT OR UPDATE ON clip_run FOR EACH ROW EXECUTE FUNCTION retain_record_media();
--> statement-breakpoint
CREATE TRIGGER canvas_media_retention BEFORE INSERT OR UPDATE OF canvas ON project FOR EACH ROW EXECUTE FUNCTION retain_record_media();
--> statement-breakpoint
CREATE FUNCTION claim_media_removal(p_project uuid, p_asset uuid, p_actor text, p_abandoned boolean DEFAULT false)
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
 OR EXISTS(SELECT 1 FROM project p WHERE p.id=p_project AND position('"'||p_asset::text||'"' in p.canvas::text)>0)
 THEN RETURN 'retained'; END IF;
 UPDATE media_asset SET status='deleting', deletion_requested_at=now() WHERE id=p_asset;
 RETURN 'deleting';
END $$;
--> statement-breakpoint
-- Never let an older completion or stale worker resurrect a tombstoned asset.
CREATE FUNCTION protect_removed_media() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status IN ('deleting','deleted') AND NEW.status NOT IN ('deleting','deleted') THEN
  RAISE EXCEPTION 'Media was removed';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_no_resurrection BEFORE UPDATE ON media_asset FOR EACH ROW EXECUTE FUNCTION protect_removed_media();
