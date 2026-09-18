-- Standalone runs have no connected inputs. Preserve that provenance when a result
-- is imported, so selective canvas execution can reuse it without another charge.
CREATE FUNCTION capture_playground_inputs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.resolved_inputs IS NULL AND NEW.authored_settings IS NOT NULL
    AND (NEW.project_id IS NULL OR NEW.source_run_id IS NOT NULL) THEN
  NEW.resolved_inputs := jsonb_build_object(
   'version', 1,
   'settings', jsonb_build_object(
    'kind', NEW.kind, 'modelId', NEW.model_id, 'content', NEW.authored_settings->>'content',
    'size', CASE WHEN NEW.kind='image' THEN NEW.size ELSE NULL END,
    'voiceId', CASE WHEN NEW.kind='speech' THEN NEW.voice_id ELSE NULL END,
    'voiceDirection', CASE WHEN NEW.kind='speech' THEN NEW.voice_direction ELSE NULL END,
    'duration', CASE WHEN NEW.kind='video' THEN NEW.duration ELSE NULL END,
    'aspectRatio', CASE WHEN NEW.kind='video' THEN NEW.aspect_ratio ELSE NULL END
   ),
   'text', '[]'::jsonb, 'image', NULL
  );
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER playground_input_history BEFORE INSERT OR UPDATE OF authored_settings ON generation_run FOR EACH ROW EXECUTE FUNCTION capture_playground_inputs();
--> statement-breakpoint
UPDATE generation_run SET authored_settings=authored_settings
WHERE resolved_inputs IS NULL AND authored_settings IS NOT NULL AND (project_id IS NULL OR source_run_id IS NOT NULL);
