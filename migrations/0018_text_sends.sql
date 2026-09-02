PRAGMA foreign_keys = ON;

CREATE TABLE sends (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  type INTEGER NOT NULL CHECK (type IN (0, 1)),
  auth_type INTEGER NOT NULL CHECK (auth_type IN (1, 2)),
  lifecycle_state TEXT NOT NULL CHECK (
    lifecycle_state IN (
      'pending_upload', 'active', 'disabled', 'expired', 'quarantined', 'deleted'
    )
  ),
  capability_envelope TEXT NOT NULL,
  capability_envelope_key_id TEXT NOT NULL,
  capability_verifier TEXT NOT NULL UNIQUE CHECK (
    length(capability_verifier) = 64
    AND capability_verifier NOT GLOB '*[^0-9a-f]*'
  ),
  capability_verifier_key_id TEXT NOT NULL,
  access_generation INTEGER NOT NULL CHECK (access_generation >= 1),
  encrypted_name TEXT NOT NULL,
  encrypted_notes TEXT,
  encrypted_key TEXT NOT NULL,
  encrypted_text TEXT,
  text_hidden INTEGER NOT NULL DEFAULT 0 CHECK (text_hidden IN (0, 1)),
  password_verifier TEXT CHECK (
    password_verifier IS NULL
    OR (
      length(password_verifier) = 64
      AND password_verifier NOT GLOB '*[^0-9a-f]*'
    )
  ),
  password_key_id TEXT,
  max_access_count INTEGER CHECK (max_access_count IS NULL OR max_access_count >= 1),
  access_count INTEGER NOT NULL DEFAULT 0 CHECK (
    access_count >= 0
    AND (max_access_count IS NULL OR access_count <= max_access_count)
  ),
  disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
  hide_email INTEGER NOT NULL DEFAULT 0 CHECK (hide_email IN (0, 1)),
  expiration_at TEXT,
  deletion_at TEXT NOT NULL,
  revision_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  quarantined_at TEXT,
  last_accessed_at TEXT,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (type != 0 OR encrypted_text IS NOT NULL),
  CHECK (expiration_at IS NULL OR expiration_at <= deletion_at),
  CHECK (
    (auth_type = 1 AND password_verifier IS NOT NULL AND password_key_id IS NOT NULL)
    OR (auth_type = 2 AND password_verifier IS NULL AND password_key_id IS NULL)
  ),
  CHECK (
    (lifecycle_state = 'deleted' AND deleted_at IS NOT NULL)
    OR (lifecycle_state != 'deleted')
  ),
  CHECK (
    lifecycle_state != 'quarantined' OR quarantined_at IS NOT NULL
  )
);

CREATE INDEX idx_sends_owner_active
  ON sends(owner_user_id, type, deleted_at, revision_date);

CREATE INDEX idx_sends_retention
  ON sends(lifecycle_state, deletion_at, deleted_at);

INSERT INTO schema_migrations (version)
VALUES ('0018')
ON CONFLICT(version) DO NOTHING;
