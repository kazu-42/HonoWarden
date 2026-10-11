-- Legacy sessions require a fresh login; no token generation is inferred.
ALTER TABLE devices ADD COLUMN session_id TEXT;
ALTER TABLE refresh_tokens ADD COLUMN session_id TEXT;

INSERT INTO schema_migrations (version)
VALUES ('0023')
ON CONFLICT(version) DO NOTHING;
