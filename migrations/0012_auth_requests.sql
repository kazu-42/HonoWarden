PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS auth_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  email_hash TEXT NOT NULL,
  request_type INTEGER NOT NULL CHECK (request_type IN (0, 1)),
  request_device_identifier TEXT NOT NULL,
  request_device_type INTEGER NOT NULL,
  request_public_key TEXT NOT NULL,
  access_code_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'consumed', 'expired')),
  request_approved INTEGER CHECK (request_approved IN (0, 1)),
  approving_device_identifier TEXT,
  encrypted_response_key TEXT,
  created_at TEXT NOT NULL,
  response_at TEXT,
  consumed_at TEXT,
  expires_at TEXT NOT NULL,
  retention_delete_after TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (approving_device_identifier IS NULL OR approving_device_identifier <> request_device_identifier),
  CHECK (status <> 'approved' OR (request_approved = 1 AND encrypted_response_key IS NOT NULL AND response_at IS NOT NULL)),
  CHECK (status <> 'denied' OR (request_approved = 0 AND encrypted_response_key IS NULL AND response_at IS NOT NULL)),
  CHECK (status <> 'consumed' OR (request_approved = 1 AND encrypted_response_key IS NOT NULL AND consumed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_auth_requests_owner_status_expires
  ON auth_requests(user_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_auth_requests_requester_status
  ON auth_requests(request_device_identifier, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_auth_requests_retention
  ON auth_requests(retention_delete_after);

INSERT INTO schema_migrations (version)
VALUES ('0012')
ON CONFLICT(version) DO NOTHING;
