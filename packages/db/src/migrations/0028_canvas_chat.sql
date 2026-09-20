CREATE TABLE "canvas_chat" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"canvas_id" uuid NOT NULL,
	"previous_id" uuid,
	"message" text NOT NULL,
	"status" text NOT NULL,
	"proposal" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "canvas_chat_status_valid" CHECK ("canvas_chat"."status" in ('running', 'succeeded', 'failed')),
	CONSTRAINT "canvas_chat_result_valid" CHECK (("canvas_chat"."status" = 'succeeded' and "canvas_chat"."proposal" is not null) or ("canvas_chat"."status" <> 'succeeded' and "canvas_chat"."proposal" is null))
);
--> statement-breakpoint
ALTER TABLE "canvas_chat" ADD CONSTRAINT "canvas_chat_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_chat" ADD CONSTRAINT "canvas_chat_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_chat" ADD CONSTRAINT "canvas_chat_canvas_id_project_canvas_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."project_canvas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "canvas_chat_history_idx" ON "canvas_chat" USING btree ("user_id","canvas_id","created_at","id");--> statement-breakpoint
CREATE INDEX "canvas_chat_limit_idx" ON "canvas_chat" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE FUNCTION kousa_claim_canvas_chat(p_id uuid, p_user text, p_project uuid, p_canvas uuid, p_message text, p_previous uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE existing canvas_chat%ROWTYPE; inserted_id uuid;
BEGIN
  -- Serialize the per-user quota and idempotency check even over Neon HTTP.
  PERFORM 1 FROM "user" WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN '{"claimed":false,"error":"FORBIDDEN"}'::jsonb; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM project p JOIN project_canvas c ON c.project_id = p.id
    WHERE p.id = p_project AND c.id = p_canvas AND (p.owner_id = p_user OR EXISTS (
      SELECT 1 FROM project_member m WHERE m.project_id = p.id AND m.user_id = p_user AND m.role = 'editor'
    ))
  ) THEN RETURN '{"claimed":false,"error":"FORBIDDEN"}'::jsonb; END IF;
  SELECT * INTO existing FROM canvas_chat WHERE id = p_id;
  IF FOUND THEN
    IF existing.user_id <> p_user OR existing.project_id <> p_project OR existing.canvas_id <> p_canvas
      OR existing.message <> p_message OR existing.previous_id IS DISTINCT FROM p_previous
      THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
    RETURN '{"claimed":false}'::jsonb;
  END IF;
  IF p_previous IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM canvas_chat WHERE id = p_previous AND user_id = p_user AND project_id = p_project AND canvas_id = p_canvas AND status = 'succeeded'
  ) THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
  IF EXISTS (SELECT 1 FROM canvas_chat WHERE user_id = p_user AND status = 'running' AND expires_at > now())
    THEN RETURN '{"claimed":false,"error":"BUSY"}'::jsonb; END IF;
  IF (SELECT count(*) FROM canvas_chat WHERE user_id = p_user AND created_at > now() - interval '1 hour') >= 20
    THEN RETURN '{"claimed":false,"error":"LIMIT"}'::jsonb; END IF;
  INSERT INTO canvas_chat (id,user_id,project_id,canvas_id,previous_id,message,status,expires_at)
    VALUES (p_id,p_user,p_project,p_canvas,p_previous,p_message,'running',now() + interval '90 seconds')
    ON CONFLICT (id) DO NOTHING RETURNING id INTO inserted_id;
  IF inserted_id IS NULL THEN RETURN '{"claimed":false,"error":"CONFLICT"}'::jsonb; END IF;
  RETURN '{"claimed":true}'::jsonb;
END;
$$;
