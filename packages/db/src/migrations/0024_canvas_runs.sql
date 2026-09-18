ALTER TABLE "clip_run" ADD COLUMN "canvas_id" uuid;--> statement-breakpoint
ALTER TABLE "generation_run" ADD COLUMN "canvas_id" uuid;--> statement-breakpoint
ALTER TABLE "graph_run" ADD COLUMN "canvas_id" uuid;--> statement-breakpoint
ALTER TABLE "clip_run" ADD CONSTRAINT "clip_run_canvas_id_project_canvas_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."project_canvas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_run" ADD CONSTRAINT "generation_run_canvas_id_project_canvas_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."project_canvas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_run" ADD CONSTRAINT "graph_run_canvas_id_project_canvas_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."project_canvas"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
UPDATE generation_run SET canvas_id=project_id;
--> statement-breakpoint
ALTER TABLE generation_run ALTER COLUMN canvas_id SET NOT NULL;

--> statement-breakpoint
UPDATE graph_run SET canvas_id=project_id;
--> statement-breakpoint
ALTER TABLE graph_run ALTER COLUMN canvas_id SET NOT NULL;

--> statement-breakpoint
UPDATE clip_run SET canvas_id=project_id;
--> statement-breakpoint
ALTER TABLE clip_run ALTER COLUMN canvas_id SET NOT NULL;

--> statement-breakpoint
-- Older workers and direct single-generation inserts use the first canvas.
-- Workflow children inherit the canvas from their saved workflow.
CREATE FUNCTION assign_run_canvas() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
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
CREATE TRIGGER assign_canvas BEFORE INSERT OR UPDATE OF canvas_id, project_id ON generation_run FOR EACH ROW EXECUTE FUNCTION assign_run_canvas();

--> statement-breakpoint
CREATE TRIGGER assign_canvas BEFORE INSERT OR UPDATE OF canvas_id, project_id ON graph_run FOR EACH ROW EXECUTE FUNCTION assign_run_canvas();

--> statement-breakpoint
CREATE TRIGGER assign_canvas BEFORE INSERT OR UPDATE OF canvas_id, project_id ON clip_run FOR EACH ROW EXECUTE FUNCTION assign_run_canvas();

--> statement-breakpoint
DROP FUNCTION kousa_claim_generation(uuid,text,uuid,uuid,text,text,text,integer,text,text,text,text,integer,text,uuid,text,jsonb,jsonb);
--> statement-breakpoint
CREATE FUNCTION kousa_claim_generation(
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
  IF (p_input_image IS NULL) <> (p_input_origin IS NULL) OR (p_input_image IS NOT NULL AND (
    p_kind <> 'video' OR NOT EXISTS (
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
DROP FUNCTION kousa_claim_graph(uuid,text,uuid,uuid,text,jsonb,uuid);
--> statement-breakpoint
CREATE FUNCTION kousa_claim_graph(p_id uuid, p_user text, p_project uuid, p_node uuid, p_hash text, p_plan jsonb, p_resume uuid, p_canvas uuid DEFAULT NULL)
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
  IF NOT EXISTS (SELECT 1 FROM project_canvas WHERE project_id=p_project AND id=coalesce(p_canvas,p_project)) THEN RETURN '{"claimed":false,"error":"FORBIDDEN"}'::jsonb; END IF;
  IF EXISTS (SELECT 1 FROM generation_run WHERE id = p_id) THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
  SELECT * INTO existing FROM graph_run WHERE id = p_id;
  IF FOUND THEN
    IF existing.user_id <> p_user OR existing.project_id <> p_project OR existing.canvas_id <> coalesce(p_canvas,p_project) OR existing.node_id <> p_node OR existing.input_hash <> p_hash OR existing.resume_of IS DISTINCT FROM p_resume
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
    SELECT 1 FROM graph_run WHERE id = p_resume AND canvas_id=coalesce(p_canvas,p_project) AND user_id = p_user AND project_id = p_project AND node_id = p_node AND status in ('failed', 'cancelled') AND input_hash = p_hash
  ) OR EXISTS (SELECT 1 FROM graph_run WHERE resume_of = p_resume))
    THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_plan) s
    WHERE (s->>'reused')::boolean AND NOT EXISTS (
      SELECT 1 FROM generation_run r WHERE r.id = (s->>'runId')::uuid
        AND r.project_id = p_project AND r.canvas_id=coalesce(p_canvas,p_project) AND r.node_id = (s->>'nodeId')::uuid
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
  INSERT INTO graph_run(id, user_id, project_id, canvas_id, node_id, input_hash, plan, remaining_credits, resume_of, expires_at)
    VALUES(p_id, p_user, p_project, coalesce(p_canvas,p_project), p_node, p_hash, p_plan, cost, p_resume, now() + interval '60 minutes') ON CONFLICT(id) DO NOTHING;
  IF NOT FOUND THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
  RETURN '{"claimed":true}'::jsonb;
END;
$$;
--> statement-breakpoint
DROP FUNCTION kousa_claim_clip(uuid,text,uuid,uuid,text,jsonb);
--> statement-breakpoint
CREATE FUNCTION kousa_claim_clip(p_id uuid, p_user text, p_project uuid, p_node uuid, p_hash text, p_plan jsonb, p_canvas uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE previous clip_run;
BEGIN
 PERFORM 1 FROM project WHERE id = p_project FOR UPDATE;
 IF NOT EXISTS (SELECT 1 FROM project p WHERE p.id = p_project AND (p.owner_id = p_user OR EXISTS
 (SELECT 1 FROM project_member m WHERE m.project_id = p.id AND m.user_id = p_user AND m.role = 'editor'))) THEN RETURN 'FORBIDDEN'; END IF;
 IF NOT EXISTS (SELECT 1 FROM project_canvas WHERE project_id=p_project AND id=coalesce(p_canvas,p_project)) THEN RETURN 'FORBIDDEN'; END IF;
 SELECT * INTO previous FROM clip_run WHERE id = p_id;
 IF FOUND THEN
  IF previous.user_id <> p_user OR previous.project_id <> p_project OR previous.canvas_id <> coalesce(p_canvas,p_project) OR previous.node_id <> p_node OR previous.input_hash <> p_hash THEN RETURN 'CONFLICT'; END IF;
  RETURN 'EXISTING';
 END IF;
 UPDATE clip_run SET status='failed', error='Clip creation expired. Create the clip again.', completed_at=now()
 WHERE (project_id=p_project OR user_id=p_user) AND status in ('queued','rendering','saving') AND expires_at <= now();
 INSERT INTO clip_run(id, project_id, canvas_id, user_id, node_id, input_hash, plan, expires_at)
 VALUES(p_id, p_project, coalesce(p_canvas,p_project), p_user, p_node, p_hash, p_plan, now() + interval '30 minutes') ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN 'BUSY'; END IF;
 RETURN 'CLAIMED';
END $$;