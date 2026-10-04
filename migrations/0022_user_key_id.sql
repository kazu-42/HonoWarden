ALTER TABLE users ADD COLUMN user_key_id TEXT
  CHECK (
    user_key_id IS NULL OR (
      length(user_key_id) = 32
      AND length(CAST(user_key_id AS BLOB)) = 32
      AND user_key_id NOT GLOB '*[^0-9a-f]*'
    )
  );

-- Older writers cannot carry an ID into a different wrapped-key generation.
-- Password/KDF rewraps conservatively require a new client backfill as well.
CREATE TRIGGER users_invalidate_stale_user_key_id
AFTER UPDATE OF user_key ON users
WHEN NEW.user_key IS NOT OLD.user_key
  AND NEW.user_key_id IS OLD.user_key_id
  AND OLD.user_key_id IS NOT NULL
BEGIN
  UPDATE users SET user_key_id = NULL WHERE id = NEW.id;
END;

INSERT INTO schema_migrations (version)
VALUES ('0022')
ON CONFLICT(version) DO NOTHING;
