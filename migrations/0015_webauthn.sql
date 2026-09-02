PRAGMA foreign_keys = ON;

CREATE TABLE webauthn_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  user_handle TEXT NOT NULL,
  sign_count INTEGER NOT NULL CHECK (sign_count >= 0),
  credential_type TEXT NOT NULL CHECK (credential_type IN ('public-key')),
  transports TEXT NOT NULL CHECK (json_valid(transports)),
  aaguid TEXT NOT NULL,
  discoverable INTEGER NOT NULL CHECK (discoverable IN (0, 1)),
  backup_eligible INTEGER NOT NULL CHECK (backup_eligible IN (0, 1)),
  backup_state INTEGER NOT NULL CHECK (backup_state IN (0, 1)),
  prf_supported INTEGER NOT NULL CHECK (prf_supported IN (0, 1)),
  encrypted_user_key TEXT,
  encrypted_public_key TEXT,
  encrypted_private_key TEXT,
  name TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 64),
  created_at TEXT NOT NULL,
  revision_date TEXT NOT NULL,
  last_used_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (
    (
      encrypted_user_key IS NULL
      AND encrypted_public_key IS NULL
      AND encrypted_private_key IS NULL
    )
    OR (
      encrypted_user_key IS NOT NULL
      AND encrypted_public_key IS NOT NULL
      AND encrypted_private_key IS NOT NULL
    )
  )
);

CREATE INDEX idx_webauthn_credentials_user_revision
  ON webauthn_credentials(user_id, revision_date, id);

CREATE TABLE webauthn_challenges (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  challenge_hash TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('registration', 'authentication', 'prf_key_set')),
  user_id TEXT,
  credential_id TEXT,
  rp_id TEXT NOT NULL,
  origin_policy_version TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  retention_delete_after TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (purpose = 'authentication' OR user_id IS NOT NULL),
  CHECK (purpose <> 'prf_key_set' OR credential_id IS NOT NULL)
);

CREATE INDEX idx_webauthn_challenges_retention
  ON webauthn_challenges(retention_delete_after);

CREATE INDEX idx_webauthn_challenges_expires
  ON webauthn_challenges(expires_at);

INSERT INTO schema_migrations (version)
VALUES ('0015')
ON CONFLICT(version) DO NOTHING;
