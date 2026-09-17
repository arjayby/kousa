ALTER TABLE "generation_run" DROP CONSTRAINT "generation_kind_valid";--> statement-breakpoint
ALTER TABLE "generation_run" DROP CONSTRAINT "generation_result_valid";--> statement-breakpoint
ALTER TABLE "media_asset" DROP CONSTRAINT "media_asset_mime";--> statement-breakpoint
ALTER TABLE "media_asset" DROP CONSTRAINT "media_asset_bytes";--> statement-breakpoint
ALTER TABLE "media_asset" DROP CONSTRAINT "media_asset_dimensions";--> statement-breakpoint
ALTER TABLE "generation_run" ADD COLUMN "duration" integer;--> statement-breakpoint
ALTER TABLE "generation_run" ADD COLUMN "aspect_ratio" text;--> statement-breakpoint
ALTER TABLE "generation_run" ADD COLUMN "provider_operation" jsonb;--> statement-breakpoint
ALTER TABLE "generation_run" ADD CONSTRAINT "generation_video_settings" CHECK ("generation_run"."kind" <> 'video' or ("generation_run"."duration" is not null and "generation_run"."duration" in (5,10) and "generation_run"."aspect_ratio" is not null and "generation_run"."aspect_ratio" in ('1:1','16:9','9:16','4:3')));--> statement-breakpoint
ALTER TABLE "generation_run" ADD CONSTRAINT "generation_kind_valid" CHECK ("generation_run"."kind" in ('text', 'image', 'speech', 'video'));--> statement-breakpoint
ALTER TABLE "generation_run" ADD CONSTRAINT "generation_result_valid" CHECK (("generation_run"."status" = 'succeeded' and "generation_run"."completed_at" is not null and (("generation_run"."kind" = 'text' and "generation_run"."output" is not null and length("generation_run"."output") > 0 and "generation_run"."asset_id" is null) or ("generation_run"."kind" in ('image', 'speech', 'video') and "generation_run"."output" is null and "generation_run"."asset_id" is not null))) or ("generation_run"."status" <> 'succeeded' and "generation_run"."output" is null and "generation_run"."asset_id" is null));--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_mime" CHECK ("media_asset"."mime_type" in ('image/png', 'image/jpeg', 'image/webp', 'audio/mpeg', 'video/mp4'));--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_bytes" CHECK ("media_asset"."bytes" between 1 and (case when "media_asset"."mime_type" = 'video/mp4' then 20971520 else 10485760 end));--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_dimensions" CHECK (("media_asset"."mime_type" in ('image/png', 'image/jpeg', 'image/webp') and "media_asset"."width" is not null and "media_asset"."height" is not null and "media_asset"."width" > 0 and "media_asset"."height" > 0 and "media_asset"."width"::bigint * "media_asset"."height" <= 40000000 and "media_asset"."duration_ms" is null) or ("media_asset"."mime_type" = 'audio/mpeg' and "media_asset"."width" is null and "media_asset"."height" is null and "media_asset"."duration_ms" is not null and "media_asset"."duration_ms" between 1 and 180000) or ("media_asset"."mime_type" = 'video/mp4' and "media_asset"."width" is not null and "media_asset"."height" is not null and "media_asset"."width" between 1 and 1920 and "media_asset"."height" between 1 and 1920 and "media_asset"."duration_ms" is not null and "media_asset"."duration_ms" between 1 and 12000));
--> statement-breakpoint
DROP FUNCTION kousa_claim_generation(uuid, text, uuid, uuid, text, text, text, integer, text, text, text, text);
--> statement-breakpoint
CREATE FUNCTION kousa_claim_generation(
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

  INSERT INTO generation_run (id, project_id, node_id, user_id, model_id, prompt, input_hash, status, credits, expires_at, kind, size, stage, voice_id, voice_direction, duration, aspect_ratio)
    VALUES (p_id, p_project, p_node, p_user, p_model, p_prompt, p_hash, 'queued', p_credits, now() + interval '30 minutes', p_kind, p_size, 'queued', p_voice, p_direction, p_duration, p_aspect_ratio)
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
  IF run.kind in ('image', 'speech', 'video') THEN
    UPDATE media_asset SET status = 'ready' WHERE id = p_asset AND project_id = run.project_id
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
