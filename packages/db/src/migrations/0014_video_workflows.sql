-- Preserve the atomic parent-to-child credit transfer while adding video settings
-- and resolving starting images from the immutable execution plan.
CREATE OR REPLACE FUNCTION kousa_begin_graph_step(p_graph uuid, p_index integer, p_prompt text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE flow graph_run%ROWTYPE; planned_step jsonb; child uuid; cost integer; input_image uuid; input_origin text;
BEGIN
  SELECT * INTO flow FROM graph_run WHERE id = p_graph;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM "user" WHERE id = flow.user_id FOR UPDATE;
  PERFORM 1 FROM project WHERE id = flow.project_id FOR UPDATE;
  SELECT * INTO flow FROM graph_run WHERE id = p_graph FOR UPDATE;
  IF flow.status <> 'running' OR flow.expires_at <= now() THEN RETURN false; END IF;
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
  IF planned_step->>'kind' = 'video' AND planned_step->'image' IS NOT NULL AND planned_step->'image' <> 'null'::jsonb THEN
    input_origin := nullif(planned_step->>'inputImageOrigin', '');
    IF input_origin IS NULL THEN RETURN false; END IF;
    IF planned_step->'image'->>'imageSource' = 'project' THEN
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
        AND r.project_id = flow.project_id AND r.user_id = flow.user_id
        AND r.kind = 'image' AND r.status = 'succeeded';
    END IF;
    IF input_image IS NULL OR NOT EXISTS (
      SELECT 1 FROM media_asset WHERE id = input_image AND project_id = flow.project_id
        AND status = 'ready' AND mime_type IN ('image/png', 'image/jpeg', 'image/webp')
    ) THEN RETURN false; END IF;
  END IF;
  INSERT INTO generation_run(id, graph_run_id, project_id, node_id, user_id, model_id, prompt, input_hash, status, credits, expires_at, kind, size, stage, duration, aspect_ratio, input_image_asset_id, input_image_origin)
    VALUES(child, flow.id, flow.project_id, (planned_step->>'nodeId')::uuid, flow.user_id, planned_step->>'modelId', p_prompt, planned_step->>'inputHash', 'queued', cost,
      least(flow.expires_at, now() + interval '30 minutes'), planned_step->>'kind', planned_step->>'size', 'queued',
      (planned_step->>'duration')::integer, planned_step->>'aspectRatio', input_image, input_origin);
  UPDATE graph_run SET remaining_credits = remaining_credits - cost WHERE id = flow.id;
  RETURN true;
END;
$$;
