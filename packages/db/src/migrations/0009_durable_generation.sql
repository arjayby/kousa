ALTER TABLE "generation_run" DROP CONSTRAINT "generation_status_valid";--> statement-breakpoint
DROP INDEX "generation_active_node_uidx";--> statement-breakpoint
DROP INDEX "generation_active_user_uidx";--> statement-breakpoint
ALTER TABLE "generation_run" ADD COLUMN "size" text;--> statement-breakpoint
ALTER TABLE "generation_run" ADD COLUMN "stage" text DEFAULT 'generating' NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_run" ADD COLUMN "provider_started_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "generation_pending_idx" ON "generation_run" USING btree ("expires_at") WHERE "generation_run"."status" in ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "generation_active_node_uidx" ON "generation_run" USING btree ("project_id","node_id") WHERE "generation_run"."status" in ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "generation_active_user_uidx" ON "generation_run" USING btree ("user_id") WHERE "generation_run"."status" in ('queued', 'running');--> statement-breakpoint
ALTER TABLE "generation_run" ADD CONSTRAINT "generation_stage_valid" CHECK ("generation_run"."stage" in ('queued', 'generating', 'saving'));--> statement-breakpoint
ALTER TABLE "generation_run" ADD CONSTRAINT "generation_status_valid" CHECK ("generation_run"."status" in ('queued', 'running', 'succeeded', 'failed'));
--> statement-breakpoint
-- Legacy synchronous calls cannot be safely resumed after deployment.
UPDATE generation_run SET status = 'failed', error = 'The previous run was interrupted. Your credits were released.', completed_at = now()
WHERE status = 'running';
--> statement-breakpoint
DROP FUNCTION kousa_claim_generation(uuid, text, uuid, uuid, text, text, text, integer, text);
--> statement-breakpoint
CREATE FUNCTION kousa_claim_generation(
  p_id uuid, p_user text, p_project uuid, p_node uuid,
  p_model text, p_prompt text, p_hash text, p_credits integer, p_kind text DEFAULT 'text', p_size text DEFAULT NULL
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

  INSERT INTO generation_run (id, project_id, node_id, user_id, model_id, prompt, input_hash, status, credits, expires_at, kind, size, stage)
    VALUES (p_id, p_project, p_node, p_user, p_model, p_prompt, p_hash, 'queued', p_credits, now() + interval '30 minutes', p_kind, p_size, 'queued')
    ON CONFLICT (id) DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NULL THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
  RETURN '{"claimed":true}'::jsonb;
END;
$$;

--> statement-breakpoint
CREATE FUNCTION kousa_start_generation(p_id uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE run generation_run%ROWTYPE;
BEGIN
  SELECT * INTO run FROM generation_run WHERE id = p_id;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM "user" WHERE id = run.user_id FOR UPDATE;
  PERFORM 1 FROM project WHERE id = run.project_id FOR UPDATE;
  SELECT * INTO run FROM generation_run WHERE id = p_id FOR UPDATE;
  IF run.status <> 'queued' OR run.expires_at <= now() OR run.provider_started_at IS NOT NULL THEN RETURN false; END IF;
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
  UPDATE generation_run SET status = 'running', stage = 'generating', provider_started_at = now() WHERE id = p_id;
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION kousa_finish_generation(p_id uuid, p_output text, p_asset uuid, p_input_tokens integer, p_output_tokens integer)
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
  IF run.kind = 'image' THEN
    UPDATE media_asset SET status = 'ready' WHERE id = p_asset AND project_id = run.project_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Generation asset does not belong to this project'; END IF;
  END IF;
  UPDATE generation_run SET status = 'succeeded', output = p_output, asset_id = p_asset,
    input_tokens = p_input_tokens, output_tokens = p_output_tokens, completed_at = now() WHERE id = p_id;
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION kousa_finish_image_generation(p_id uuid, p_asset uuid)
RETURNS boolean LANGUAGE sql AS $$
  SELECT kousa_finish_generation(p_id, NULL, p_asset, NULL, NULL);
$$;
