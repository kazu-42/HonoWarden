PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN email_verified_at TEXT;

UPDATE users
SET email_verified_at = COALESCE(created_at, CURRENT_TIMESTAMP)
WHERE email_verified_at IS NULL;

CREATE TABLE account_lifecycle_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (
    purpose IN ('email_change', 'email_verify', 'account_delete')
  ),
  token_digest TEXT NOT NULL UNIQUE CHECK (length(token_digest) = 64),
  target_email_normalized TEXT,
  credential_generation TEXT NOT NULL,
  delivery_state TEXT NOT NULL CHECK (
    delivery_state IN ('pending', 'accepted', 'failed')
  ),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  superseded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (
    (purpose = 'email_change' AND target_email_normalized IS NOT NULL)
    OR (purpose != 'email_change' AND target_email_normalized IS NULL)
  ),
  CHECK (consumed_at IS NULL OR superseded_at IS NULL)
);

CREATE INDEX idx_account_lifecycle_tokens_expiry
  ON account_lifecycle_tokens(expires_at, purpose);

CREATE UNIQUE INDEX idx_account_lifecycle_tokens_active_purpose
  ON account_lifecycle_tokens(user_id, purpose)
  WHERE consumed_at IS NULL AND superseded_at IS NULL;

CREATE TABLE account_deletions (
  user_id TEXT PRIMARY KEY,
  lifecycle_generation TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (
    state IN (
      'recoverable', 'purge_ready', 'purging_r2', 'tombstoned', 'recovered'
    )
  ),
  requested_at TEXT NOT NULL,
  recover_until TEXT NOT NULL,
  purge_started_at TEXT,
  purge_operation_id TEXT,
  tombstoned_at TEXT,
  recovered_at TEXT,
  personal_r2_expected_count INTEGER NOT NULL DEFAULT 0 CHECK (
    personal_r2_expected_count >= 0
  ),
  personal_r2_deleted_count INTEGER NOT NULL DEFAULT 0 CHECK (
    personal_r2_deleted_count >= 0
    AND personal_r2_deleted_count <= personal_r2_expected_count
  ),
  last_error_code TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (recover_until > requested_at),
  CHECK (state != 'purging_r2' OR purge_started_at IS NOT NULL),
  CHECK (state != 'tombstoned' OR tombstoned_at IS NOT NULL),
  CHECK (state != 'recovered' OR recovered_at IS NOT NULL)
);

CREATE INDEX idx_account_deletions_state_cutoff
  ON account_deletions(state, recover_until);

INSERT INTO schema_migrations (version)
VALUES ('0017')
ON CONFLICT(version) DO NOTHING;
