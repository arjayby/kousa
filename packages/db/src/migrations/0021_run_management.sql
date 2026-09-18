ALTER TABLE "generation_run" DROP CONSTRAINT "generation_status_valid";--> statement-breakpoint
ALTER TABLE "graph_run" DROP CONSTRAINT "graph_run_status_valid";--> statement-breakpoint
ALTER TABLE "generation_run" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "graph_run" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "generation_project_history_idx" ON "generation_run" USING btree ("project_id","created_at","id") WHERE "generation_run"."graph_run_id" is null;--> statement-breakpoint
ALTER TABLE "generation_run" ADD CONSTRAINT "generation_status_valid" CHECK ("generation_run"."status" in ('queued', 'running', 'succeeded', 'failed', 'cancelled'));--> statement-breakpoint
ALTER TABLE "graph_run" ADD CONSTRAINT "graph_run_status_valid" CHECK ("graph_run"."status" in ('running', 'succeeded', 'failed', 'cancelled'));
--> statement-breakpoint
-- Cancellation shares the payer -> project -> run lock order with submission.
-- The actor and project are checked again inside the transaction.
CREATE FUNCTION kousa_cancel_generation(p_id uuid, p_project uuid, p_actor text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE run generation_run%ROWTYPE;
BEGIN
  SELECT * INTO run FROM generation_run WHERE id = p_id AND project_id = p_project;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  PERFORM 1 FROM "user" WHERE id = run.user_id FOR UPDATE;
  PERFORM 1 FROM project WHERE id = p_project FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM project p WHERE p.id = p_project AND (p.owner_id = p_actor OR EXISTS (
    SELECT 1 FROM project_member m WHERE m.project_id = p.id AND m.user_id = p_actor AND m.role = 'editor'
  ))) THEN RETURN 'FORBIDDEN'; END IF;
  SELECT * INTO run FROM generation_run WHERE id = p_id FOR UPDATE;
  IF run.graph_run_id IS NOT NULL THEN RETURN 'CONFLICT'; END IF;
  IF run.status NOT IN ('queued', 'running') THEN RETURN 'OK'; END IF;
  IF run.status = 'queued' AND run.provider_started_at IS NULL THEN
    UPDATE generation_run SET status = 'cancelled', cancel_requested_at = now(), completed_at = now()
      WHERE id = p_id;
  ELSE
    -- We cannot promise that an already-submitted provider request can be aborted.
    UPDATE generation_run SET cancel_requested_at = coalesce(cancel_requested_at, now()) WHERE id = p_id;
  END IF;
  RETURN 'OK';
END;
$$;
--> statement-breakpoint
CREATE FUNCTION kousa_cancel_graph(p_id uuid, p_project uuid, p_actor text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE flow graph_run%ROWTYPE;
BEGIN
  SELECT * INTO flow FROM graph_run WHERE id = p_id AND project_id = p_project;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  PERFORM 1 FROM "user" WHERE id = flow.user_id FOR UPDATE;
  PERFORM 1 FROM project WHERE id = p_project FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM project p WHERE p.id = p_project AND (p.owner_id = p_actor OR EXISTS (
    SELECT 1 FROM project_member m WHERE m.project_id = p.id AND m.user_id = p_actor AND m.role = 'editor'
  ))) THEN RETURN 'FORBIDDEN'; END IF;
  SELECT * INTO flow FROM graph_run WHERE id = p_id FOR UPDATE;
  IF flow.status <> 'running' THEN RETURN 'OK'; END IF;
  -- Completion won the race. Keep the successful run and its charges intact.
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(flow.plan) s WHERE NOT EXISTS (
    SELECT 1 FROM generation_run r WHERE r.id = (s->>'runId')::uuid AND r.status = 'succeeded'
  )) THEN
    UPDATE graph_run SET status = 'succeeded', remaining_credits = 0, completed_at = now() WHERE id = p_id;
    RETURN 'OK';
  END IF;
  UPDATE graph_run SET cancel_requested_at = coalesce(cancel_requested_at, now()), remaining_credits = 0 WHERE id = p_id;
  UPDATE generation_run SET cancel_requested_at = coalesce(cancel_requested_at, now()),
    status = CASE WHEN status = 'queued' AND provider_started_at IS NULL THEN 'cancelled' ELSE status END,
    completed_at = CASE WHEN status = 'queued' AND provider_started_at IS NULL THEN now() ELSE completed_at END
    WHERE graph_run_id = p_id AND status in ('queued', 'running');
  IF NOT EXISTS (SELECT 1 FROM generation_run WHERE graph_run_id = p_id AND status in ('queued', 'running')) THEN
    UPDATE graph_run SET status = 'cancelled', completed_at = now() WHERE id = p_id;
  END IF;
  RETURN 'OK';
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
  IF planned_step->>'kind' = 'video' AND planned_step->'image' IS NOT NULL AND planned_step->'image' <> 'null'::jsonb THEN
    input_origin := nullif(planned_step->>'inputImageOrigin', '');
    IF input_origin IS NULL THEN RETURN false; END IF;
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


--> statement-breakpoint
CREATE OR REPLACE FUNCTION kousa_claim_graph(p_id uuid, p_user text, p_project uuid, p_node uuid, p_hash text, p_plan jsonb, p_resume uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE existing graph_run%ROWTYPE; cost integer;
BEGIN
  PERFORM 1 FROM "user" WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN '{"claimed":false,"error":"FORBIDDEN"}'::jsonb; END IF;
  PERFORM 1 FROM project WHERE id = p_project FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM project p WHERE p.id = p_project AND (p.owner_id = p_user OR EXISTS (
      SELECT 1 FROM project_member m WHERE m.project_id = p.id AND m.user_id = p_user AND m.role = 'editor'
    ))
  ) THEN RETURN '{"claimed":false,"error":"FORBIDDEN"}'::jsonb; END IF;
  IF EXISTS (SELECT 1 FROM generation_run WHERE id = p_id) THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
  SELECT * INTO existing FROM graph_run WHERE id = p_id;
  IF FOUND THEN
    IF existing.user_id <> p_user OR existing.project_id <> p_project OR existing.node_id <> p_node OR existing.input_hash <> p_hash OR existing.resume_of IS DISTINCT FROM p_resume
      THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
    RETURN '{"claimed":false}'::jsonb;
  END IF;
  UPDATE generation_run SET status = 'failed', error = 'The run timed out. Your credits were released.', completed_at = now()
    WHERE status in ('queued','running') AND expires_at <= now() AND (user_id = p_user OR project_id = p_project);
  UPDATE graph_run SET status = 'failed', remaining_credits = 0, error = 'The workflow timed out. Resume to continue unfinished steps.', completed_at = now()
    WHERE status = 'running' AND expires_at <= now() AND (user_id = p_user OR project_id = p_project);
  IF EXISTS (SELECT 1 FROM graph_run WHERE status = 'running' AND (user_id = p_user OR project_id = p_project))
    OR EXISTS (SELECT 1 FROM generation_run WHERE status in ('queued','running') AND (user_id = p_user OR project_id = p_project))
    THEN RETURN '{"claimed":false,"error":"BUSY"}'::jsonb; END IF;
  IF p_resume IS NOT NULL AND (NOT EXISTS (
    SELECT 1 FROM graph_run WHERE id = p_resume AND user_id = p_user AND project_id = p_project AND node_id = p_node AND status in ('failed', 'cancelled') AND input_hash = p_hash
  ) OR EXISTS (SELECT 1 FROM graph_run WHERE resume_of = p_resume))
    THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_plan) s
    WHERE (s->>'reused')::boolean AND NOT EXISTS (
      SELECT 1 FROM generation_run r WHERE r.id = (s->>'runId')::uuid
        AND r.project_id = p_project AND r.node_id = (s->>'nodeId')::uuid
        AND r.kind = s->>'kind' AND r.status = 'succeeded'
        AND (r.asset_id IS NULL OR EXISTS (
          SELECT 1 FROM media_asset a WHERE a.id = r.asset_id AND a.project_id = p_project AND a.status = 'ready'
        ))
    )
  ) THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
  SELECT coalesce(sum((s->>'credits')::integer), 0) INTO cost FROM jsonb_array_elements(p_plan) s WHERE NOT (s->>'reused')::boolean;
  IF cost < 0 OR (
    (SELECT coalesce(sum(credits),0) FROM credit_grant WHERE user_id = p_user) -
    (SELECT coalesce(sum(credits),0) FROM generation_run WHERE user_id = p_user AND (status = 'succeeded' OR (status in ('queued','running') AND expires_at > now())))
  ) < cost THEN RETURN '{"claimed":false,"error":"NO_CREDITS"}'::jsonb; END IF;
  INSERT INTO graph_run(id, user_id, project_id, node_id, input_hash, plan, remaining_credits, resume_of, expires_at)
    VALUES(p_id, p_user, p_project, p_node, p_hash, p_plan, cost, p_resume, now() + interval '60 minutes') ON CONFLICT(id) DO NOTHING;
  IF NOT FOUND THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
  RETURN '{"claimed":true}'::jsonb;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION kousa_finish_graph(p_id uuid, p_error text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE flow graph_run%ROWTYPE;
BEGIN
  SELECT * INTO flow FROM graph_run WHERE id = p_id;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM "user" WHERE id = flow.user_id FOR UPDATE;
  PERFORM 1 FROM project WHERE id = flow.project_id FOR UPDATE;
  SELECT * INTO flow FROM graph_run WHERE id = p_id FOR UPDATE;
  IF flow.status <> 'running' THEN RETURN false; END IF;
  -- A stop request releases only unsubmitted work. Submitted children retain their
  -- reservation until they settle or hit their original expiry, even on retries.
  IF flow.cancel_requested_at IS NOT NULL THEN
    UPDATE generation_run SET status = 'failed', error = 'The run timed out. Your credits were released.', completed_at = now()
      WHERE graph_run_id = p_id AND status in ('queued', 'running') AND expires_at <= now();
    IF EXISTS (SELECT 1 FROM generation_run WHERE graph_run_id = p_id AND status in ('queued', 'running')) THEN RETURN false; END IF;
    UPDATE graph_run SET status = 'cancelled', remaining_credits = 0, completed_at = now() WHERE id = p_id;
    RETURN true;
  END IF;
  -- Completion is derived from the ledger, never from a client or workflow checkpoint.
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(flow.plan) s WHERE NOT EXISTS (
    SELECT 1 FROM generation_run r WHERE r.id = (s->>'runId')::uuid AND r.status = 'succeeded'
  )) THEN
    UPDATE graph_run SET status = 'succeeded', remaining_credits = 0, completed_at = now() WHERE id = p_id;
  ELSIF p_error IS NOT NULL THEN
    UPDATE generation_run SET status = 'failed', error = p_error, completed_at = now()
      WHERE graph_run_id = p_id AND status in ('queued','running');
    UPDATE graph_run SET status = 'failed', remaining_credits = 0, error = p_error, completed_at = now() WHERE id = p_id;
  ELSE RETURN false;
  END IF;
  RETURN true;
END;
$$;
