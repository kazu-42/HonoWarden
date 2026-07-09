PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS request_quota_buckets (
  bucket_key TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('anonymous', 'authenticated')),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  window_started_at TEXT NOT NULL,
  blocked_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_request_quota_buckets_blocked_until
  ON request_quota_buckets(blocked_until);

CREATE INDEX IF NOT EXISTS idx_request_quota_buckets_scope_updated
  ON request_quota_buckets(scope, updated_at);

INSERT INTO schema_migrations (version)
VALUES ('0008')
ON CONFLICT(version) DO NOTHING;
