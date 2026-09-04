PRAGMA foreign_keys = ON;

CREATE TABLE send_files (
  id TEXT PRIMARY KEY,
  send_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  object_generation INTEGER NOT NULL CHECK (object_generation >= 1),
  object_key TEXT NOT NULL UNIQUE,
  encrypted_file_name TEXT NOT NULL,
  expected_size INTEGER NOT NULL CHECK (expected_size >= 1),
  observed_size INTEGER CHECK (
    observed_size IS NULL OR observed_size >= 1
  ),
  object_etag TEXT,
  lifecycle_state TEXT NOT NULL CHECK (
    lifecycle_state IN ('pending_upload', 'active', 'deleted')
  ),
  upload_deadline_at TEXT NOT NULL,
  validated_at TEXT,
  cleanup_lease_until TEXT,
  cleanup_attempts INTEGER NOT NULL DEFAULT 0 CHECK (cleanup_attempts >= 0),
  last_failure_class TEXT,
  deleted_at TEXT,
  FOREIGN KEY (send_id) REFERENCES sends(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (send_id, object_generation),
  CHECK (
    (lifecycle_state = 'deleted' AND deleted_at IS NOT NULL)
    OR (lifecycle_state != 'deleted')
  ),
  CHECK (
    (lifecycle_state = 'active' AND observed_size IS NOT NULL AND validated_at IS NOT NULL)
    OR (lifecycle_state != 'active')
  )
);

CREATE INDEX idx_send_files_owner_pending
  ON send_files(owner_user_id, lifecycle_state, upload_deadline_at);

CREATE INDEX idx_send_files_cleanup
  ON send_files(lifecycle_state, cleanup_lease_until, object_generation);

CREATE TABLE send_download_tickets (
  ticket_verifier TEXT PRIMARY KEY CHECK (
    length(ticket_verifier) = 64
    AND ticket_verifier NOT GLOB '*[^0-9a-f]*'
  ),
  send_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  access_generation INTEGER NOT NULL CHECK (access_generation >= 1),
  object_generation INTEGER NOT NULL CHECK (object_generation >= 1),
  expires_at TEXT NOT NULL,
  max_requests INTEGER NOT NULL CHECK (max_requests >= 1),
  remaining_bytes INTEGER NOT NULL CHECK (remaining_bytes >= 0),
  consumed_requests INTEGER NOT NULL DEFAULT 0 CHECK (consumed_requests >= 0),
  FOREIGN KEY (send_id) REFERENCES sends(id) ON DELETE CASCADE,
  FOREIGN KEY (file_id) REFERENCES send_files(id) ON DELETE CASCADE,
  CHECK (consumed_requests <= max_requests)
);

CREATE INDEX idx_send_download_tickets_expiry
  ON send_download_tickets(expires_at);

INSERT INTO schema_migrations (version)
VALUES ('0019')
ON CONFLICT(version) DO NOTHING;
