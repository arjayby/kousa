CREATE TABLE clip_run (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES project(id),
 user_id text NOT NULL REFERENCES "user"(id), node_id uuid NOT NULL,
 input_hash text NOT NULL, plan jsonb NOT NULL,
 status text NOT NULL DEFAULT 'queued', asset_id uuid REFERENCES media_asset(id), error text,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 completed_at timestamptz,
 CONSTRAINT clip_run_status_valid CHECK (status in ('queued','rendering','saving','succeeded','failed')),
 CONSTRAINT clip_run_result_valid CHECK ((status = 'succeeded') = (asset_id IS NOT NULL))
 );
--> statement-breakpoint
CREATE INDEX clip_run_project_idx ON clip_run(project_id, created_at );
--> statement-breakpoint
CREATE UNIQUE INDEX clip_run_active_project_uidx ON clip_run(project_id) WHERE status in ('queued','rendering','saving' );
--> statement-breakpoint
CREATE UNIQUE INDEX clip_run_active_user_uidx ON clip_run(user_id) WHERE status in ('queued','rendering','saving');
--> statement-breakpoint
CREATE FUNCTION kousa_claim_clip(p_id uuid, p_user text, p_project uuid, p_node uuid, p_hash text, p_plan jsonb)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE previous clip_run;
BEGIN
 PERFORM 1 FROM project WHERE id = p_project FOR UPDATE;
 IF NOT EXISTS (SELECT 1 FROM project p WHERE p.id = p_project AND (p.owner_id = p_user OR EXISTS
 (SELECT 1 FROM project_member m WHERE m.project_id = p.id AND m.user_id = p_user AND m.role = 'editor'))) THEN RETURN 'FORBIDDEN'; END IF;
 SELECT * INTO previous FROM clip_run WHERE id = p_id;
 IF FOUND THEN
  IF previous.user_id <> p_user OR previous.project_id <> p_project OR previous.node_id <> p_node OR previous.input_hash <> p_hash THEN RETURN 'CONFLICT'; END IF;
  RETURN 'EXISTING';
 END IF;
 UPDATE clip_run SET status='failed', error='Clip creation expired. Create the clip again.', completed_at=now()
 WHERE (project_id=p_project OR user_id=p_user) AND status in ('queued','rendering','saving') AND expires_at <= now();
 INSERT INTO clip_run(id, project_id, user_id, node_id, input_hash, plan, expires_at)
 VALUES(p_id, p_project, p_user, p_node, p_hash, p_plan, now() + interval '30 minutes') ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN 'BUSY'; END IF;
 RETURN 'CLAIMED';
END $$;
--> statement-breakpoint
CREATE FUNCTION kousa_finish_clip(p_id uuid, p_asset uuid)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE r clip_run;
BEGIN
 SELECT * INTO r FROM clip_run WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF r.status='succeeded' THEN RETURN r.asset_id=p_asset; END IF;
 IF r.status='failed' OR r.expires_at <= now() OR NOT EXISTS
 (SELECT 1 FROM project p WHERE p.id=r.project_id AND (p.owner_id=r.user_id OR EXISTS
 (SELECT 1 FROM project_member m WHERE m.project_id=p.id AND m.user_id=r.user_id AND m.role='editor'))) THEN RETURN false; END IF;
 UPDATE media_asset SET status='ready' WHERE id=p_asset AND project_id=r.project_id AND mime_type='video/mp4';
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE clip_run SET status='succeeded', asset_id=p_asset, completed_at=now(), error=NULL WHERE id=p_id;
 RETURN true;
END $$;
