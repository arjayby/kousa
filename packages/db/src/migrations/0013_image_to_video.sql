ALTER TABLE "generation_run" ADD COLUMN "input_image_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "generation_run" ADD COLUMN "input_image_origin" text;--> statement-breakpoint
ALTER TABLE "generation_run" ADD COLUMN "input_image_token_hash" text;--> statement-breakpoint
ALTER TABLE "generation_run" ADD CONSTRAINT "generation_run_input_image_asset_id_media_asset_id_fk" FOREIGN KEY ("input_image_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_run" ADD CONSTRAINT "generation_input_image_valid" CHECK (("generation_run"."input_image_asset_id" is null and "generation_run"."input_image_origin" is null and "generation_run"."input_image_token_hash" is null) or ("generation_run"."kind" = 'video' and "generation_run"."input_image_asset_id" is not null and "generation_run"."input_image_origin" is not null and ("generation_run"."input_image_token_hash" is null or "generation_run"."input_image_token_hash" ~ '^[a-f0-9]{64}$')));
--> statement-breakpoint
DROP FUNCTION kousa_claim_generation(uuid, text, uuid, uuid, text, text, text, integer, text, text, text, text, integer, text);
--> statement-breakpoint
CREATE FUNCTION kousa_claim_generation(
  p_id uuid, p_user text, p_project uuid, p_node uuid,
  p_model text, p_prompt text, p_hash text, p_credits integer, p_kind text DEFAULT 'text', p_size text DEFAULT NULL, p_voice text DEFAULT NULL, p_direction text DEFAULT NULL, p_duration integer DEFAULT NULL, p_aspect_ratio text DEFAULT NULL,
  p_input_image uuid DEFAULT NULL, p_input_origin text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
  PERFORM 1 FROM "user" WHERE id = p_user FOR UPDATE;
  PERFORM 1 FROM project WHERE id = p_project FOR UPDATE;
  IF EXISTS (SELECT 1 FROM graph_run WHERE id = p_id) THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
  IF NOT EXISTS (SELECT 1 FROM generation_run WHERE id = p_id) AND EXISTS (
    SELECT 1 FROM graph_run WHERE status = 'running' AND expires_at > now()
      AND (user_id = p_user OR project_id = p_project)
  ) THEN RETURN '{"claimed":false,"error":"BUSY"}'::jsonb; END IF;
  IF (p_input_image IS NULL) <> (p_input_origin IS NULL) OR (p_input_image IS NOT NULL AND (
    p_kind <> 'video' OR NOT EXISTS (
      SELECT 1 FROM media_asset WHERE id = p_input_image AND project_id = p_project
        AND status = 'ready' AND mime_type IN ('image/png', 'image/jpeg', 'image/webp')
    )
  )) THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
  result := kousa_claim_single_generation(p_id, p_user, p_project, p_node, p_model, p_prompt, p_hash, p_credits, p_kind, p_size, p_voice, p_direction, p_duration, p_aspect_ratio);
  IF (result->>'claimed')::boolean THEN
    UPDATE generation_run SET input_image_asset_id = p_input_image, input_image_origin = p_input_origin WHERE id = p_id;
  END IF;
  RETURN result;
END;
$$;
