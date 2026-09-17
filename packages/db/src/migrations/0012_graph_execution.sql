CREATE TABLE "graph_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"node_id" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"plan" jsonb NOT NULL,
	"resume_of" uuid,
	"status" text DEFAULT 'running' NOT NULL,
	"remaining_credits" integer NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "graph_run_status_valid" CHECK ("graph_run"."status" in ('running', 'succeeded', 'failed')),
	CONSTRAINT "graph_run_reservation_valid" CHECK ("graph_run"."remaining_credits" >= 0 and ("graph_run"."status" = 'running' or "graph_run"."remaining_credits" = 0)),
	CONSTRAINT "graph_run_plan_valid" CHECK (jsonb_typeof("graph_run"."plan") = 'array' and jsonb_array_length("graph_run"."plan") between 1 and 20)
);
--> statement-breakpoint
ALTER TABLE "generation_run" ADD COLUMN "graph_run_id" uuid;--> statement-breakpoint
ALTER TABLE "graph_run" ADD CONSTRAINT "graph_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_run" ADD CONSTRAINT "graph_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "graph_run_project_idx" ON "graph_run" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "graph_run_active_user_uidx" ON "graph_run" USING btree ("user_id") WHERE "graph_run"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "graph_run_active_project_uidx" ON "graph_run" USING btree ("project_id") WHERE "graph_run"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "graph_run_resume_uidx" ON "graph_run" USING btree ("resume_of");--> statement-breakpoint
ALTER TABLE "generation_run" ADD CONSTRAINT "generation_run_graph_run_id_graph_run_id_fk" FOREIGN KEY ("graph_run_id") REFERENCES "public"."graph_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Share the payer -> project lock order with every existing credit operation.
ALTER FUNCTION kousa_claim_generation(uuid, text, uuid, uuid, text, text, text, integer, text, text, text, text, integer, text) RENAME TO kousa_claim_single_generation;
--> statement-breakpoint
CREATE FUNCTION kousa_claim_generation(
  p_id uuid, p_user text, p_project uuid, p_node uuid,
  p_model text, p_prompt text, p_hash text, p_credits integer, p_kind text DEFAULT 'text', p_size text DEFAULT NULL, p_voice text DEFAULT NULL, p_direction text DEFAULT NULL, p_duration integer DEFAULT NULL, p_aspect_ratio text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "user" WHERE id = p_user FOR UPDATE;
  PERFORM 1 FROM project WHERE id = p_project FOR UPDATE;
  IF EXISTS (SELECT 1 FROM graph_run WHERE id = p_id) THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
  IF NOT EXISTS (SELECT 1 FROM generation_run WHERE id = p_id) AND EXISTS (
    SELECT 1 FROM graph_run WHERE status = 'running' AND expires_at > now()
      AND (user_id = p_user OR project_id = p_project)
  ) THEN RETURN '{"claimed":false,"error":"BUSY"}'::jsonb; END IF;
  RETURN kousa_claim_single_generation(p_id, p_user, p_project, p_node, p_model, p_prompt, p_hash, p_credits, p_kind, p_size, p_voice, p_direction, p_duration, p_aspect_ratio);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION kousa_claim_graph(p_id uuid, p_user text, p_project uuid, p_node uuid, p_hash text, p_plan jsonb, p_resume uuid)
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
    IF existing.user_id <> p_user OR existing.project_id <> p_project OR existing.node_id <> p_node OR existing.resume_of IS DISTINCT FROM p_resume
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
--> statement-breakpoint
CREATE FUNCTION kousa_begin_graph_step(p_graph uuid, p_index integer, p_prompt text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE flow graph_run%ROWTYPE; item jsonb; child uuid; cost integer;
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
  item := flow.plan->p_index;
  child := (item->>'runId')::uuid;
  IF EXISTS (SELECT 1 FROM generation_run WHERE id = child) THEN RETURN true; END IF;
  IF (item->>'reused')::boolean THEN RETURN false; END IF;
  cost := (item->>'credits')::integer;
  INSERT INTO generation_run(id, graph_run_id, project_id, node_id, user_id, model_id, prompt, input_hash, status, credits, expires_at, kind, size, stage)
    VALUES(child, flow.id, flow.project_id, (item->>'nodeId')::uuid, flow.user_id, item->>'modelId', p_prompt, item->>'inputHash', 'queued', cost,
      least(flow.expires_at, now() + interval '30 minutes'), item->>'kind', item->>'size', 'queued');
  UPDATE graph_run SET remaining_credits = remaining_credits - cost WHERE id = flow.id;
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION kousa_finish_graph(p_id uuid, p_error text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE flow graph_run%ROWTYPE;
BEGIN
  SELECT * INTO flow FROM graph_run WHERE id = p_id;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM "user" WHERE id = flow.user_id FOR UPDATE;
  PERFORM 1 FROM project WHERE id = flow.project_id FOR UPDATE;
  SELECT * INTO flow FROM graph_run WHERE id = p_id FOR UPDATE;
  IF flow.status <> 'running' THEN RETURN false; END IF;
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
