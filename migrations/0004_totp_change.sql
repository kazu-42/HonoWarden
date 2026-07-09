PRAGMA foreign_keys = ON;

ALTER TABLE user_totp
  ADD COLUMN pending_encrypted_secret TEXT;

ALTER TABLE user_totp
  ADD COLUMN pending_created_at TEXT;

INSERT INTO schema_migrations (version)
VALUES ('0004')
ON CONFLICT(version) DO NOTHING;
