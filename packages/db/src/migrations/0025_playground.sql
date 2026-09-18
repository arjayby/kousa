ALTER TABLE "generation_run" DROP CONSTRAINT "generation_credits_positive";--> statement-breakpoint
ALTER TABLE "generation_run" ALTER COLUMN "canvas_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_run" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "media_asset" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_run" ADD COLUMN "source_run_id" uuid;--> statement-breakpoint
ALTER TABLE "media_asset" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_personal_history_idx" ON "generation_run" USING btree ("user_id","created_at","id") WHERE "generation_run"."project_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_import_uidx" ON "generation_run" USING btree ("source_run_id","canvas_id","user_id") WHERE "generation_run"."source_run_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "media_asset_personal_hash_uidx" ON "media_asset" USING btree ("owner_id","sha256") WHERE "media_asset"."project_id" is null and "media_asset"."status" <> 'deleted';--> statement-breakpoint
ALTER TABLE "generation_run" ADD CONSTRAINT "generation_scope" CHECK (("generation_run"."project_id" is not null and "generation_run"."canvas_id" is not null) or ("generation_run"."project_id" is null and "generation_run"."canvas_id" is null and "generation_run"."graph_run_id" is null and "generation_run"."source_run_id" is null));--> statement-breakpoint
ALTER TABLE "generation_run" ADD CONSTRAINT "generation_credits_positive" CHECK (("generation_run"."source_run_id" is null and "generation_run"."credits" > 0) or ("generation_run"."source_run_id" is not null and "generation_run"."credits" = 0 and "generation_run"."status" = 'succeeded' and "generation_run"."project_id" is not null));--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_scope" CHECK (("media_asset"."project_id" is not null and "media_asset"."owner_id" is null) or ("media_asset"."project_id" is null and "media_asset"."owner_id" is not null));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION assign_run_canvas() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='generation_run' AND NEW.project_id IS NULL THEN RETURN NEW; END IF;
 IF NEW.canvas_id IS NULL THEN
  IF TG_TABLE_NAME='generation_run' AND to_jsonb(NEW)->>'graph_run_id' IS NOT NULL THEN
   SELECT canvas_id INTO NEW.canvas_id FROM graph_run WHERE id=(to_jsonb(NEW)->>'graph_run_id')::uuid;
  END IF;
  NEW.canvas_id := coalesce(NEW.canvas_id, NEW.project_id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM project_canvas WHERE id=NEW.canvas_id AND project_id=NEW.project_id) THEN
  RAISE EXCEPTION 'Canvas does not belong to project';
 END IF;
 RETURN NEW;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION kousa_claim_single_generation(
  p_id uuid, p_user text, p_project uuid, p_node uuid,
  p_model text, p_prompt text, p_hash text, p_credits integer, p_kind text DEFAULT 'text', p_size text DEFAULT NULL, p_voice text DEFAULT NULL, p_direction text DEFAULT NULL, p_duration integer DEFAULT NULL, p_aspect_ratio text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE existing generation_run%ROWTYPE; inserted_id uuid;
BEGIN
  PERFORM 1 FROM "user" WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN '{"claimed":false,"error":"FORBIDDEN"}'::jsonb; END IF;
  PERFORM 1 FROM project WHERE id = p_project FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM project p WHERE p.id = p_project AND
      (p.owner_id = p_user OR EXISTS (
        SELECT 1 FROM project_member m WHERE m.project_id = p.id
          AND m.user_id = p_user AND m.role = 'editor'
      ))
  ) THEN RETURN '{"claimed":false,"error":"FORBIDDEN"}'::jsonb; END IF;

  UPDATE generation_run SET status = 'failed',
    error = 'The run timed out. Your credit was released.', completed_at = now()
    WHERE status in ('queued', 'running') AND expires_at <= now()
      AND (user_id = p_user OR project_id = p_project);

  SELECT * INTO existing FROM generation_run WHERE id = p_id;
  IF FOUND THEN
    IF existing.user_id <> p_user OR existing.project_id IS DISTINCT FROM p_project OR existing.node_id <> p_node
      THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
    RETURN '{"claimed":false}'::jsonb;
  END IF;
  IF EXISTS (SELECT 1 FROM generation_run WHERE status in ('queued', 'running')
    AND (user_id = p_user OR (project_id = p_project AND node_id = p_node)))
    THEN RETURN '{"claimed":false,"error":"BUSY"}'::jsonb; END IF;
  IF p_credits <= 0 OR (
    (SELECT coalesce(sum(credits), 0) FROM credit_grant WHERE user_id = p_user) -
    (SELECT coalesce(sum(credits), 0) FROM generation_run WHERE user_id = p_user
      AND (status = 'succeeded' OR (status in ('queued', 'running') AND expires_at > now())))
  ) < p_credits THEN RETURN '{"claimed":false,"error":"NO_CREDITS"}'::jsonb; END IF;

  INSERT INTO generation_run (id, project_id, node_id, user_id, model_id, prompt, input_hash, status, credits, expires_at, kind, size, stage, voice_id, voice_direction, duration, aspect_ratio)
    VALUES (p_id, p_project, p_node, p_user, p_model, p_prompt, p_hash, 'queued', p_credits, now() + interval '30 minutes', p_kind, p_size, 'queued', p_voice, p_direction, p_duration, p_aspect_ratio)
    ON CONFLICT (id) DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NULL THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
  RETURN '{"claimed":true}'::jsonb;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION kousa_start_generation(p_id uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE run generation_run%ROWTYPE;
BEGIN
  SELECT * INTO run FROM generation_run WHERE id = p_id;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM "user" WHERE id = run.user_id FOR UPDATE;
  PERFORM 1 FROM project WHERE id = run.project_id FOR UPDATE;
  SELECT * INTO run FROM generation_run WHERE id = p_id FOR UPDATE;
  IF run.status <> 'queued' OR run.expires_at <= now() OR run.provider_started_at IS NOT NULL THEN RETURN false; END IF;
  IF run.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM project p WHERE p.id = run.project_id AND
      (p.owner_id = run.user_id OR EXISTS (
        SELECT 1 FROM project_member m WHERE m.project_id = p.id AND m.user_id = run.user_id AND m.role = 'editor'
      ))
  ) THEN
    UPDATE generation_run SET status = 'failed', completed_at = now(),
      error = 'Your editing access changed. Your credits were released.' WHERE id = p_id;
    RETURN false;
  END IF;
  UPDATE generation_run SET status = 'running', stage = 'generating', provider_started_at = now() WHERE id = p_id;
  RETURN true;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION kousa_finish_generation(p_id uuid, p_output text, p_asset uuid, p_input_tokens integer, p_output_tokens integer)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE run generation_run%ROWTYPE;
BEGIN
  SELECT * INTO run FROM generation_run WHERE id = p_id;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM "user" WHERE id = run.user_id FOR UPDATE;
  PERFORM 1 FROM project WHERE id = run.project_id FOR UPDATE;
  SELECT * INTO run FROM generation_run WHERE id = p_id FOR UPDATE;
  IF run.status <> 'running' OR run.expires_at <= now() THEN RETURN false; END IF;
  IF run.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM project p WHERE p.id = run.project_id AND
      (p.owner_id = run.user_id OR EXISTS (
        SELECT 1 FROM project_member m WHERE m.project_id = p.id AND m.user_id = run.user_id AND m.role = 'editor'
      ))
  ) THEN
    UPDATE generation_run SET status = 'failed', completed_at = now(),
      error = 'Your editing access changed. Your credits were released.' WHERE id = p_id;
    RETURN false;
  END IF;
  IF run.kind in ('image', 'speech', 'video') THEN
    UPDATE media_asset SET status = 'ready' WHERE id = p_asset AND status IN ('pending','ready') AND ((run.project_id IS NOT NULL AND project_id = run.project_id) OR (run.project_id IS NULL AND project_id IS NULL AND owner_id = run.user_id))
      AND ((run.kind = 'image' AND mime_type in ('image/png', 'image/jpeg', 'image/webp'))
        OR (run.kind = 'speech' AND mime_type = 'audio/mpeg')
        OR (run.kind = 'video' AND mime_type = 'video/mp4'));
    IF NOT FOUND THEN RAISE EXCEPTION 'Generation asset does not match the project and media type'; END IF;
  END IF;
  UPDATE generation_run SET status = 'succeeded', output = p_output, asset_id = p_asset,
    input_tokens = p_input_tokens, output_tokens = p_output_tokens, completed_at = now() WHERE id = p_id;
  RETURN true;
END;
$$;

--> statement-breakpoint
CREATE FUNCTION kousa_claim_playground(p_id uuid, p_user text, p_model text, p_prompt text, p_hash text, p_credits integer, p_kind text, p_size text, p_voice text, p_direction text, p_duration integer, p_aspect text, p_settings jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE existing generation_run;
BEGIN
 PERFORM 1 FROM "user" WHERE id=p_user FOR UPDATE;
 IF NOT FOUND THEN RETURN '{"claimed":false,"error":"FORBIDDEN"}'::jsonb; END IF;
 IF EXISTS (SELECT 1 FROM graph_run WHERE id=p_id) THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
 SELECT * INTO existing FROM generation_run WHERE id=p_id;
 IF FOUND THEN
  IF existing.user_id<>p_user OR existing.project_id IS NOT NULL OR existing.input_hash<>p_hash THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
  RETURN '{"claimed":false}'::jsonb;
 END IF;
 UPDATE generation_run SET status='failed', error='The run timed out. Your credits were released.', completed_at=now() WHERE user_id=p_user AND status IN ('queued','running') AND expires_at<=now();
 IF EXISTS (SELECT 1 FROM generation_run WHERE user_id=p_user AND status IN ('queued','running')) OR EXISTS (SELECT 1 FROM graph_run WHERE user_id=p_user AND status='running' AND expires_at>now()) THEN RETURN '{"claimed":false,"error":"BUSY"}'::jsonb; END IF;
 IF p_credits<=0 OR (
  (SELECT coalesce(sum(credits),0) FROM credit_grant WHERE user_id=p_user) -
  (SELECT coalesce(sum(credits),0) FROM generation_run WHERE user_id=p_user AND (status='succeeded' OR (status IN ('queued','running') AND expires_at>now()))) -
  (SELECT coalesce(sum(remaining_credits),0) FROM graph_run WHERE user_id=p_user AND status='running' AND expires_at>now())
 ) < p_credits THEN RETURN '{"claimed":false,"error":"NO_CREDITS"}'::jsonb; END IF;
 INSERT INTO generation_run(id, user_id, node_id, model_id, prompt, input_hash, credits, kind, size, voice_id, voice_direction, duration, aspect_ratio, authored_settings, status, stage, expires_at)
 VALUES(p_id, p_user, p_id, p_model, p_prompt, p_hash, p_credits, p_kind, p_size, p_voice, p_direction, p_duration, p_aspect, p_settings, 'queued','queued',now()+interval '30 minutes') ON CONFLICT(id) DO NOTHING;
 IF NOT FOUND THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
 RETURN '{"claimed":true}'::jsonb;
END $$;

--> statement-breakpoint
CREATE FUNCTION reserve_personal_media(p_user text, p_hash text, p_name text, p_mime text, p_bytes integer, p_width integer, p_height integer, p_duration integer)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE a media_asset;
BEGIN
 PERFORM 1 FROM "user" WHERE id=p_user FOR UPDATE;
 IF NOT FOUND THEN RETURN 'forbidden'; END IF;
 SELECT * INTO a FROM media_asset WHERE owner_id=p_user AND project_id IS NULL AND sha256=p_hash AND status<>'deleted' FOR UPDATE;
 IF FOUND THEN
  IF a.status='deleting' THEN RETURN 'deleting'; END IF;
  RETURN a.id::text;
 END IF;
 IF (SELECT count(*)>=100 OR coalesce(sum(bytes),0)+p_bytes>104857600 FROM media_asset WHERE owner_id=p_user AND project_id IS NULL AND status<>'deleted') THEN RETURN 'full'; END IF;
 INSERT INTO media_asset(owner_id,uploader_id,sha256,name,mime_type,bytes,width,height,duration_ms,retention_reason)
 VALUES(p_user,p_user,p_hash,p_name,p_mime,p_bytes,p_width,p_height,p_duration,'generation') RETURNING * INTO a;
 RETURN a.id::text;
END $$;

--> statement-breakpoint
CREATE FUNCTION kousa_import_playground(p_id uuid, p_user text, p_source uuid, p_project uuid, p_canvas uuid, p_asset uuid, p_hash text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE source generation_run; existing_id uuid;
BEGIN
 PERFORM 1 FROM "user" WHERE id=p_user FOR UPDATE;
 PERFORM 1 FROM project WHERE id=p_project FOR UPDATE;
 IF NOT EXISTS (SELECT 1 FROM project p WHERE p.id=p_project AND (p.owner_id=p_user OR EXISTS (SELECT 1 FROM project_member m WHERE m.project_id=p.id AND m.user_id=p_user AND m.role='editor'))) OR NOT EXISTS(SELECT 1 FROM project_canvas WHERE id=p_canvas AND project_id=p_project) THEN RETURN NULL; END IF;
 SELECT * INTO source FROM generation_run WHERE id=p_source AND user_id=p_user AND project_id IS NULL AND status='succeeded';
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT id INTO existing_id FROM generation_run WHERE source_run_id=p_source AND canvas_id=p_canvas AND user_id=p_user;
 IF FOUND THEN RETURN existing_id; END IF;
 IF source.kind<>'text' AND NOT EXISTS(SELECT 1 FROM media_asset a JOIN media_asset original ON original.id=source.asset_id WHERE a.id=p_asset AND a.project_id=p_project AND a.status='ready' AND a.sha256=original.sha256 AND original.owner_id=p_user AND original.project_id IS NULL AND original.status='ready') THEN RETURN NULL; END IF;
 INSERT INTO generation_run(id,project_id,canvas_id,node_id,user_id,model_id,kind,prompt,authored_settings,size,duration,aspect_ratio,voice_id,voice_direction,input_hash,status,stage,credits,output,asset_id,expires_at,completed_at,source_run_id)
 VALUES(p_id,p_project,p_canvas,p_id,p_user,source.model_id,source.kind,source.prompt,source.authored_settings,source.size,source.duration,source.aspect_ratio,source.voice_id,source.voice_direction,p_hash,'succeeded','saving',0,source.output,p_asset,now(),now(),p_source);
 RETURN p_id;
END $$;
