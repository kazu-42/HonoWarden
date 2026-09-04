PRAGMA foreign_keys = ON;

CREATE TABLE emergency_access (
  id TEXT PRIMARY KEY,
  grantor_user_id TEXT NOT NULL,
  grantee_user_id TEXT,
  email_normalized TEXT,
  type INTEGER NOT NULL CHECK (type IN (0, 1)),
  status INTEGER NOT NULL CHECK (status IN (0, 1, 2, 3, 4)),
  wait_time_days INTEGER NOT NULL CHECK (
    wait_time_days >= 1 AND wait_time_days <= 90
  ),
  invite_token_hash TEXT CHECK (
    invite_token_hash IS NULL
    OR invite_token_hash LIKE 'hmac-sha256:v1:%'
  ),
  invite_expires_at TEXT,
  key_encrypted TEXT,
  key_generation INTEGER CHECK (
    key_generation IS NULL OR key_generation >= 1
  ),
  recovery_initiated_at TEXT,
  last_notification_at TEXT,
  created_at TEXT NOT NULL,
  revision_date TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (grantor_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (grantee_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (grantee_user_id IS NULL OR grantor_user_id <> grantee_user_id),
  CHECK (
    (
      status = 0
      AND email_normalized IS NOT NULL
      AND grantee_user_id IS NULL
      AND invite_token_hash IS NOT NULL
      AND invite_expires_at IS NOT NULL
      AND key_encrypted IS NULL
      AND key_generation IS NULL
      AND recovery_initiated_at IS NULL
    )
    OR (
      status = 1
      AND email_normalized IS NULL
      AND grantee_user_id IS NOT NULL
      AND invite_token_hash IS NULL
      AND invite_expires_at IS NULL
      AND key_encrypted IS NULL
      AND key_generation IS NULL
      AND recovery_initiated_at IS NULL
    )
    OR (
      status = 2
      AND email_normalized IS NULL
      AND grantee_user_id IS NOT NULL
      AND invite_token_hash IS NULL
      AND invite_expires_at IS NULL
      AND key_encrypted IS NOT NULL
      AND key_generation IS NOT NULL
      AND recovery_initiated_at IS NULL
    )
    OR (
      status IN (3, 4)
      AND email_normalized IS NULL
      AND grantee_user_id IS NOT NULL
      AND invite_token_hash IS NULL
      AND invite_expires_at IS NULL
      AND key_encrypted IS NOT NULL
      AND key_generation IS NOT NULL
      AND recovery_initiated_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX idx_emergency_access_grantor_email_invited
  ON emergency_access(grantor_user_id, email_normalized)
  WHERE status = 0 AND email_normalized IS NOT NULL;

CREATE UNIQUE INDEX idx_emergency_access_grantor_grantee
  ON emergency_access(grantor_user_id, grantee_user_id)
  WHERE grantee_user_id IS NOT NULL;

CREATE INDEX idx_emergency_access_grantor_status
  ON emergency_access(grantor_user_id, status, revision_date);

CREATE INDEX idx_emergency_access_grantee_status
  ON emergency_access(grantee_user_id, status, revision_date);

INSERT INTO schema_migrations (version)
VALUES ('0021')
ON CONFLICT(version) DO NOTHING;
