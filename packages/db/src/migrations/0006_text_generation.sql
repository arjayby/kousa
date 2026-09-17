CREATE TABLE "generation_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"model_id" text NOT NULL,
	"prompt" text NOT NULL,
	"input_hash" text NOT NULL,
	"status" text NOT NULL,
	"credits" integer NOT NULL,
	"output" text,
	"error" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "generation_status_valid" CHECK ("generation_run"."status" in ('running', 'succeeded', 'failed')),
	CONSTRAINT "generation_credits_positive" CHECK ("generation_run"."credits" > 0),
	CONSTRAINT "generation_result_valid" CHECK (("generation_run"."status" = 'succeeded' and length("generation_run"."output") > 0 and "generation_run"."completed_at" is not null) or ("generation_run"."status" <> 'succeeded' and "generation_run"."output" is null))
);
--> statement-breakpoint
ALTER TABLE "generation_run" ADD CONSTRAINT "generation_run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_run" ADD CONSTRAINT "generation_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_project_node_idx" ON "generation_run" USING btree ("project_id","node_id","created_at");--> statement-breakpoint
CREATE INDEX "generation_user_idx" ON "generation_run" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_active_node_uidx" ON "generation_run" USING btree ("project_id","node_id") WHERE "generation_run"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "generation_active_user_uidx" ON "generation_run" USING btree ("user_id") WHERE "generation_run"."status" = 'running';--> statement-breakpoint
-- All requests from the same payer serialize on the user row. This function's
-- statements share one transaction over Neon HTTP; each check sees committed
-- reservations after acquiring the lock (READ COMMITTED).
CREATE FUNCTION kousa_claim_generation(
  p_id uuid, p_user text, p_project uuid, p_node uuid,
  p_model text, p_prompt text, p_hash text, p_credits integer
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

  INSERT INTO generation_run (id, project_id, node_id, user_id, model_id, prompt, input_hash, status, credits, expires_at)
    VALUES (p_id, p_project, p_node, p_user, p_model, p_prompt, p_hash, 'running', p_credits, now() + interval '2 minutes')
    ON CONFLICT (id) DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NULL THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
  RETURN '{"claimed":true}'::jsonb;
END;
$$;
