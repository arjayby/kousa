ALTER TABLE "generation_run" DROP CONSTRAINT "generation_result_valid";--> statement-breakpoint
ALTER TABLE "generation_run" ADD COLUMN "kind" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_run" ADD COLUMN "asset_id" uuid;--> statement-breakpoint
ALTER TABLE "generation_run" ADD CONSTRAINT "generation_run_asset_id_media_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_run" ADD CONSTRAINT "generation_kind_valid" CHECK ("generation_run"."kind" in ('text', 'image'));--> statement-breakpoint
ALTER TABLE "generation_run" ADD CONSTRAINT "generation_result_valid" CHECK (("generation_run"."status" = 'succeeded' and "generation_run"."completed_at" is not null and (("generation_run"."kind" = 'text' and "generation_run"."output" is not null and length("generation_run"."output") > 0 and "generation_run"."asset_id" is null) or ("generation_run"."kind" = 'image' and "generation_run"."output" is null and "generation_run"."asset_id" is not null))) or ("generation_run"."status" <> 'succeeded' and "generation_run"."output" is null and "generation_run"."asset_id" is null));
--> statement-breakpoint
DROP FUNCTION kousa_claim_generation(uuid, text, uuid, uuid, text, text, text, integer);
--> statement-breakpoint
CREATE FUNCTION kousa_claim_generation(
  p_id uuid, p_user text, p_project uuid, p_node uuid,
  p_model text, p_prompt text, p_hash text, p_credits integer, p_kind text DEFAULT 'text'
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
    WHERE status = 'running' AND expires_at <= now()
      AND (user_id = p_user OR project_id = p_project);

  SELECT * INTO existing FROM generation_run WHERE id = p_id;
  IF FOUND THEN
    IF existing.user_id <> p_user OR existing.project_id <> p_project OR existing.node_id <> p_node
      THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
    RETURN '{"claimed":false}'::jsonb;
  END IF;
  IF EXISTS (SELECT 1 FROM generation_run WHERE status = 'running'
    AND (user_id = p_user OR (project_id = p_project AND node_id = p_node)))
    THEN RETURN '{"claimed":false,"error":"BUSY"}'::jsonb; END IF;
  IF p_credits <= 0 OR (
    (SELECT coalesce(sum(credits), 0) FROM credit_grant WHERE user_id = p_user) -
    (SELECT coalesce(sum(credits), 0) FROM generation_run WHERE user_id = p_user
      AND (status = 'succeeded' OR (status = 'running' AND expires_at > now())))
  ) < p_credits THEN RETURN '{"claimed":false,"error":"NO_CREDITS"}'::jsonb; END IF;

  INSERT INTO generation_run (id, project_id, node_id, user_id, model_id, prompt, input_hash, status, credits, expires_at, kind)
    VALUES (p_id, p_project, p_node, p_user, p_model, p_prompt, p_hash, 'running', p_credits, now() + CASE WHEN p_kind = 'image' THEN interval '3 minutes' ELSE interval '2 minutes' END, p_kind)
    ON CONFLICT (id) DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NULL THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
  RETURN '{"claimed":true}'::jsonb;
END;
$$;

--> statement-breakpoint
-- The R2 write has already completed. Publish the asset and spend the reservation
-- in one transaction; recheck access under the same lock used by member changes.
CREATE FUNCTION kousa_finish_image_generation(p_id uuid, p_asset uuid)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE run generation_run%ROWTYPE;
BEGIN
  SELECT * INTO run FROM generation_run WHERE id = p_id;
  IF NOT FOUND OR run.kind <> 'image' THEN RETURN false; END IF;
  PERFORM 1 FROM "user" WHERE id = run.user_id FOR UPDATE;
  PERFORM 1 FROM project WHERE id = run.project_id FOR UPDATE;
  SELECT * INTO run FROM generation_run WHERE id = p_id FOR UPDATE;
  IF run.status <> 'running' OR run.expires_at <= now() THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM project p WHERE p.id = run.project_id AND
      (p.owner_id = run.user_id OR EXISTS (
        SELECT 1 FROM project_member m WHERE m.project_id = p.id
          AND m.user_id = run.user_id AND m.role = 'editor'
      ))
  ) THEN
    UPDATE generation_run SET status = 'failed', completed_at = now(),
      error = 'Your editing access changed. Your credits were released.' WHERE id = p_id;
    RETURN false;
  END IF;
  UPDATE media_asset SET status = 'ready' WHERE id = p_asset AND project_id = run.project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Generation asset does not belong to this project'; END IF;
  UPDATE generation_run SET status = 'succeeded', asset_id = p_asset, completed_at = now() WHERE id = p_id;
  RETURN true;
END;
$$;
