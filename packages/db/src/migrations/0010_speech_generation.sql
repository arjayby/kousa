ALTER TABLE "generation_run" DROP CONSTRAINT "generation_kind_valid";--> statement-breakpoint
ALTER TABLE "generation_run" DROP CONSTRAINT "generation_result_valid";--> statement-breakpoint
ALTER TABLE "media_asset" DROP CONSTRAINT "media_asset_mime";--> statement-breakpoint
ALTER TABLE "media_asset" DROP CONSTRAINT "media_asset_dimensions";--> statement-breakpoint
ALTER TABLE "media_asset" ALTER COLUMN "width" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "media_asset" ALTER COLUMN "height" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_run" ADD COLUMN "voice_id" text;--> statement-breakpoint
ALTER TABLE "generation_run" ADD COLUMN "voice_direction" text;--> statement-breakpoint
ALTER TABLE "media_asset" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "generation_run" ADD CONSTRAINT "generation_kind_valid" CHECK ("generation_run"."kind" in ('text', 'image', 'speech'));--> statement-breakpoint
ALTER TABLE "generation_run" ADD CONSTRAINT "generation_result_valid" CHECK (("generation_run"."status" = 'succeeded' and "generation_run"."completed_at" is not null and (("generation_run"."kind" = 'text' and "generation_run"."output" is not null and length("generation_run"."output") > 0 and "generation_run"."asset_id" is null) or ("generation_run"."kind" in ('image', 'speech') and "generation_run"."output" is null and "generation_run"."asset_id" is not null))) or ("generation_run"."status" <> 'succeeded' and "generation_run"."output" is null and "generation_run"."asset_id" is null));--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_mime" CHECK ("media_asset"."mime_type" in ('image/png', 'image/jpeg', 'image/webp', 'audio/mpeg'));--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_dimensions" CHECK (("media_asset"."mime_type" <> 'audio/mpeg' and "media_asset"."width" is not null and "media_asset"."height" is not null and "media_asset"."width" > 0 and "media_asset"."height" > 0 and "media_asset"."width"::bigint * "media_asset"."height" <= 40000000 and "media_asset"."duration_ms" is null) or ("media_asset"."mime_type" = 'audio/mpeg' and "media_asset"."width" is null and "media_asset"."height" is null and "media_asset"."duration_ms" is not null and "media_asset"."duration_ms" between 1 and 180000));
--> statement-breakpoint
DROP FUNCTION reserve_media_asset(uuid, text, text, text, text, integer, integer, integer);
--> statement-breakpoint
CREATE FUNCTION reserve_media_asset(p_project uuid, p_actor text, p_hash text,
 p_name text, p_mime text, p_bytes integer, p_width integer, p_height integer, p_duration integer DEFAULT NULL)
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
 INSERT INTO media_asset(project_id, uploader_id, sha256, name, mime_type, bytes, width, height, duration_ms)
 VALUES(p_project, p_actor, p_hash, p_name, p_mime, p_bytes, p_width, p_height, p_duration)
 RETURNING id INTO asset_id;
 RETURN asset_id::text;
END;
$$;

--> statement-breakpoint
DROP FUNCTION kousa_claim_generation(uuid, text, uuid, uuid, text, text, text, integer, text, text);
--> statement-breakpoint
CREATE FUNCTION kousa_claim_generation(
  p_id uuid, p_user text, p_project uuid, p_node uuid,
  p_model text, p_prompt text, p_hash text, p_credits integer, p_kind text DEFAULT 'text', p_size text DEFAULT NULL, p_voice text DEFAULT NULL, p_direction text DEFAULT NULL
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
    IF existing.user_id <> p_user OR existing.project_id <> p_project OR existing.node_id <> p_node
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

  INSERT INTO generation_run (id, project_id, node_id, user_id, model_id, prompt, input_hash, status, credits, expires_at, kind, size, stage, voice_id, voice_direction)
    VALUES (p_id, p_project, p_node, p_user, p_model, p_prompt, p_hash, 'queued', p_credits, now() + interval '30 minutes', p_kind, p_size, 'queued', p_voice, p_direction)
    ON CONFLICT (id) DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NULL THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
  RETURN '{"claimed":true}'::jsonb;
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
  IF NOT EXISTS (
    SELECT 1 FROM project p WHERE p.id = run.project_id AND
      (p.owner_id = run.user_id OR EXISTS (
        SELECT 1 FROM project_member m WHERE m.project_id = p.id AND m.user_id = run.user_id AND m.role = 'editor'
      ))
  ) THEN
    UPDATE generation_run SET status = 'failed', completed_at = now(),
      error = 'Your editing access changed. Your credits were released.' WHERE id = p_id;
    RETURN false;
  END IF;
  IF run.kind in ('image', 'speech') THEN
    UPDATE media_asset SET status = 'ready' WHERE id = p_asset AND project_id = run.project_id
      AND ((run.kind = 'image' AND mime_type in ('image/png', 'image/jpeg', 'image/webp'))
        OR (run.kind = 'speech' AND mime_type = 'audio/mpeg'));
    IF NOT FOUND THEN RAISE EXCEPTION 'Generation asset does not match the project and media type'; END IF;
  END IF;
  UPDATE generation_run SET status = 'succeeded', output = p_output, asset_id = p_asset,
    input_tokens = p_input_tokens, output_tokens = p_output_tokens, completed_at = now() WHERE id = p_id;
  RETURN true;
END;
$$;
