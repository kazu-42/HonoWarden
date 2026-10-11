-- Existing enrollment receives a generation, never a session verification proof.
ALTER TABLE user_totp ADD COLUMN credential_generation TEXT;
ALTER TABLE devices ADD COLUMN mfa_totp_credential_generation TEXT;
ALTER TABLE devices ADD COLUMN mfa_verified_at TEXT;

UPDATE user_totp
SET credential_generation = lower(hex(randomblob(16)))
WHERE enabled = 1 AND verified_at IS NOT NULL;

-- Replacing or disabling a factor invalidates every family's earlier evidence.
CREATE TRIGGER invalidate_session_mfa_on_totp_change
AFTER UPDATE OF enabled, credential_generation ON user_totp
WHEN NEW.enabled <> 1
  OR NEW.credential_generation IS NOT OLD.credential_generation
BEGIN
  UPDATE devices
  SET mfa_totp_credential_generation = NULL, mfa_verified_at = NULL
  WHERE user_id = NEW.user_id;
END;

CREATE TRIGGER invalidate_session_mfa_on_totp_delete
AFTER DELETE ON user_totp
BEGIN
  UPDATE devices
  SET mfa_totp_credential_generation = NULL, mfa_verified_at = NULL
  WHERE user_id = OLD.user_id;
END;

INSERT INTO schema_migrations (version)
VALUES ('0027')
ON CONFLICT(version) DO NOTHING;
