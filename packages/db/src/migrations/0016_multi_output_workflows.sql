-- Bind idempotent claims to the reviewed output set and immutable plan hash.
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
    SELECT 1 FROM graph_run WHERE id = p_resume AND user_id = p_user AND project_id = p_project AND node_id = p_node AND status = 'failed' AND input_hash = p_hash
  ) OR EXISTS (SELECT 1 FROM graph_run WHERE resume_of = p_resume))
    THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
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
