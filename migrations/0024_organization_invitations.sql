ALTER TABLE organization_users ADD COLUMN invite_token_hash TEXT;
ALTER TABLE organization_users ADD COLUMN invite_expires_at TEXT;

INSERT INTO schema_migrations (version)
VALUES ('0024')
ON CONFLICT(version) DO NOTHING;
