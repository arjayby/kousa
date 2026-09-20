-- Image edits read private bytes; only video references use scoped public URLs.
ALTER TABLE generation_run DROP CONSTRAINT generation_input_image_valid;
--> statement-breakpoint
ALTER TABLE generation_run ADD CONSTRAINT generation_input_image_valid CHECK (
  (input_image_asset_id IS NULL AND input_image_origin IS NULL AND input_image_token_hash IS NULL)
  OR (kind = 'image' AND input_image_asset_id IS NOT NULL AND input_image_origin IS NULL AND input_image_token_hash IS NULL)
  OR (kind = 'video' AND input_image_asset_id IS NOT NULL AND input_image_origin IS NOT NULL
    AND (input_image_token_hash IS NULL OR input_image_token_hash ~ '^[a-f0-9]{64}$'))
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION kousa_claim_generation(
  p_id uuid, p_user text, p_project uuid, p_node uuid,
  p_model text, p_prompt text, p_hash text, p_credits integer, p_kind text DEFAULT 'text', p_size text DEFAULT NULL, p_voice text DEFAULT NULL, p_direction text DEFAULT NULL, p_duration integer DEFAULT NULL, p_aspect_ratio text DEFAULT NULL,
  p_input_image uuid DEFAULT NULL, p_input_origin text DEFAULT NULL, p_authored_settings jsonb DEFAULT NULL, p_resolved_inputs jsonb DEFAULT NULL, p_canvas uuid DEFAULT NULL
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
  IF (p_input_image IS NULL AND p_input_origin IS NOT NULL)
    OR (p_input_image IS NOT NULL AND (
      p_kind NOT IN ('image', 'video')
      OR (p_kind = 'video' AND p_input_origin IS NULL)
      OR (p_kind = 'image' AND p_input_origin IS NOT NULL)
      OR NOT EXISTS (
      SELECT 1 FROM media_asset WHERE id = p_input_image AND project_id = p_project
        AND status = 'ready' AND mime_type IN ('image/png', 'image/jpeg', 'image/webp')
    )
  )) THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
  IF NOT EXISTS (SELECT 1 FROM project_canvas WHERE project_id=p_project AND id=coalesce(p_canvas,p_project)) THEN RETURN '{"claimed":false,"error":"FORBIDDEN"}'::jsonb; END IF;
  IF EXISTS (SELECT 1 FROM generation_run WHERE id=p_id AND canvas_id<>coalesce(p_canvas,p_project)) THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
  result := kousa_claim_single_generation(p_id, p_user, p_project, p_node, p_model, p_prompt, p_hash, p_credits, p_kind, p_size, p_voice, p_direction, p_duration, p_aspect_ratio);
  IF (result->>'claimed')::boolean THEN
    UPDATE generation_run SET canvas_id=coalesce(p_canvas,p_project), input_image_asset_id = p_input_image, input_image_origin = p_input_origin, authored_settings = p_authored_settings, resolved_inputs = p_resolved_inputs WHERE id = p_id;
  END IF;
  RETURN result;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION kousa_begin_graph_step(p_graph uuid, p_index integer, p_prompt text, p_resolved_inputs jsonb DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE flow graph_run%ROWTYPE; planned_step jsonb; child uuid; cost integer; input_image uuid; input_origin text;
BEGIN
  SELECT * INTO flow FROM graph_run WHERE id = p_graph;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM "user" WHERE id = flow.user_id FOR UPDATE;
  PERFORM 1 FROM project WHERE id = flow.project_id FOR UPDATE;
  SELECT * INTO flow FROM graph_run WHERE id = p_graph FOR UPDATE;
  IF flow.status <> 'running' OR flow.cancel_requested_at IS NOT NULL OR flow.expires_at <= now() THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM project p WHERE p.id = flow.project_id AND (p.owner_id = flow.user_id OR EXISTS (
    SELECT 1 FROM project_member m WHERE m.project_id = p.id AND m.user_id = flow.user_id AND m.role = 'editor'
  ))) THEN RETURN false; END IF;
  IF p_index < 0 OR p_index >= jsonb_array_length(flow.plan) THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(flow.plan) WITH ORDINALITY s(item, pos)
    WHERE s.pos <= p_index AND NOT EXISTS (SELECT 1 FROM generation_run r WHERE r.id = (s.item->>'runId')::uuid AND r.status = 'succeeded')
  ) THEN RETURN false; END IF;
  planned_step := flow.plan->p_index;
  child := (planned_step->>'runId')::uuid;
  IF EXISTS (SELECT 1 FROM generation_run WHERE id = child) THEN RETURN true; END IF;
  IF (planned_step->>'reused')::boolean THEN RETURN false; END IF;
  cost := (planned_step->>'credits')::integer;
  IF planned_step->>'kind' IN ('image', 'video') AND planned_step->'image' IS NOT NULL AND planned_step->'image' <> 'null'::jsonb THEN
    IF planned_step->>'kind' = 'video' THEN
      input_origin := nullif(planned_step->>'inputImageOrigin', '');
      IF input_origin IS NULL THEN RETURN false; END IF;
    END IF;
    IF planned_step->'image'->>'imageSource' IN ('project', 'history') THEN
      input_image := (planned_step->'image'->>'assetId')::uuid;
    ELSIF planned_step->'image'->>'imageSource' = 'generated' THEN
      -- Use this plan's exact successful image run, including a reused run on resume.
      -- Never resolve the latest output for a canvas node here.
      SELECT r.asset_id INTO input_image
      FROM jsonb_array_elements(flow.plan) WITH ORDINALITY dependency(item, pos)
      JOIN generation_run r ON r.id = (dependency.item->>'runId')::uuid
      WHERE dependency.pos <= p_index AND dependency.item->>'kind' = 'image'
        AND dependency.item->>'nodeId' = planned_step->'image'->>'nodeId'
        AND r.node_id = (planned_step->'image'->>'nodeId')::uuid
        AND r.project_id = flow.project_id
        AND r.kind = 'image' AND r.status = 'succeeded';
    END IF;
    IF input_image IS NULL OR NOT EXISTS (
      SELECT 1 FROM media_asset WHERE id = input_image AND project_id = flow.project_id
        AND status = 'ready' AND mime_type IN ('image/png', 'image/jpeg', 'image/webp')
    ) THEN RETURN false; END IF;
  END IF;
  INSERT INTO generation_run(id, graph_run_id, project_id, node_id, user_id, model_id, prompt, input_hash, status, credits, expires_at, kind, size, stage, duration, aspect_ratio, input_image_asset_id, input_image_origin, voice_id, voice_direction, authored_settings, resolved_inputs)
    VALUES(child, flow.id, flow.project_id, (planned_step->>'nodeId')::uuid, flow.user_id, planned_step->>'modelId', p_prompt, planned_step->>'inputHash', 'queued', cost,
      least(flow.expires_at, now() + interval '30 minutes'), planned_step->>'kind', planned_step->>'size', 'queued',
      (planned_step->>'duration')::integer, planned_step->>'aspectRatio', input_image, input_origin, planned_step->>'voiceId', planned_step->>'voiceDirection', planned_step->'authoredSettings', p_resolved_inputs);
  UPDATE graph_run SET remaining_credits = remaining_credits - cost WHERE id = flow.id;
  RETURN true;
END;
$$;
