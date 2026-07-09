PRAGMA foreign_keys = ON;

ALTER TABLE devices
  ADD COLUMN encrypted_user_key TEXT;

ALTER TABLE devices
  ADD COLUMN encrypted_public_key TEXT;

ALTER TABLE devices
  ADD COLUMN encrypted_private_key TEXT;

INSERT INTO schema_migrations (version)
VALUES ('0005');
