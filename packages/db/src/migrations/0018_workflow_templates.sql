CREATE TABLE workflow_template (
 id uuid PRIMARY KEY,
 owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 source_project_id uuid NOT NULL,
 request_hash text NOT NULL,
 name text NOT NULL,
 document jsonb,
 node_count integer NOT NULL,
 edge_count integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz,
 CONSTRAINT workflow_template_name_length CHECK (char_length(btrim(name)) between 1 and 120),
 CONSTRAINT workflow_template_counts CHECK (node_count between 1 and 200 and edge_count between 0 and 600),
 CONSTRAINT workflow_template_document_present CHECK ((deleted_at is null) = (document is not null))
);
--> statement-breakpoint
CREATE INDEX workflow_template_owner_idx ON workflow_template(owner_id, updated_at);
--> statement-breakpoint
ALTER TABLE project ADD COLUMN source_template_id uuid REFERENCES workflow_template(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE project ADD COLUMN template_request_hash text;
--> statement-breakpoint
CREATE FUNCTION kousa_save_template(p_id uuid, p_user text, p_source uuid, p_hash text, p_name text, p_document jsonb)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE previous workflow_template;
BEGIN
 -- Serialize one user's saves, including request retries and the library limit.
 PERFORM 1 FROM "user" WHERE id=p_user FOR UPDATE;
 SELECT * INTO previous FROM workflow_template WHERE id=p_id;
 IF FOUND THEN
  IF previous.owner_id <> p_user OR previous.request_hash <> p_hash THEN RETURN 'CONFLICT'; END IF;
  IF previous.deleted_at IS NOT NULL THEN RETURN 'NOT_FOUND'; END IF;
  RETURN 'EXISTING';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM project p WHERE p.id=p_source AND (p.owner_id=p_user OR EXISTS
  (SELECT 1 FROM project_member m WHERE m.project_id=p.id AND m.user_id=p_user AND m.role='editor'))) THEN RETURN 'FORBIDDEN'; END IF;
 IF (SELECT count(*) FROM workflow_template WHERE owner_id=p_user AND deleted_at IS NULL) >= 100 THEN RETURN 'LIMIT'; END IF;
 INSERT INTO workflow_template(id, owner_id, source_project_id, request_hash, name, document, node_count, edge_count)
 VALUES(p_id, p_user, p_source, p_hash, p_name, p_document, jsonb_array_length(p_document->'nodes'), jsonb_array_length(p_document->'edges'))
 ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN 'CONFLICT'; END IF;
 RETURN 'CREATED';
END $$;
--> statement-breakpoint
CREATE FUNCTION kousa_project_from_template(p_id uuid, p_user text, p_template uuid, p_hash text, p_name text, p_document jsonb)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE previous project;
BEGIN
 PERFORM 1 FROM "user" WHERE id=p_user FOR UPDATE;
 SELECT * INTO previous FROM project WHERE id=p_id;
 IF FOUND THEN
  IF previous.owner_id=p_user AND previous.template_request_hash=p_hash THEN RETURN 'EXISTING'; END IF;
  RETURN 'CONFLICT';
 END IF;
 -- Lock the snapshot against deletion until its new project is committed.
 PERFORM 1 FROM workflow_template WHERE id=p_template AND owner_id=p_user AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
 INSERT INTO project(id, name, owner_id, canvas, canvas_updated_at, source_template_id, template_request_hash)
 VALUES(p_id, p_name, p_user, p_document, now(), p_template, p_hash) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN 'CONFLICT'; END IF;
 RETURN 'CREATED';
END $$;
