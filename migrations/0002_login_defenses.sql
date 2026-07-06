PRAGMA foreign_keys = ON;

ALTER TABLE users
  ADD COLUMN login_failed_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN login_failed_at TEXT;

ALTER TABLE users
  ADD COLUMN login_locked_until TEXT;

CREATE TABLE IF NOT EXISTS auth_attempts (
  id TEXT PRIMARY KEY,
  bucket_key TEXT NOT NULL,
  subject_key TEXT,
  successful INTEGER NOT NULL DEFAULT 0 CHECK (successful IN (0, 1)),
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_failure_buckets (
  bucket_key TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  locked_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_attempts_bucket_occurred
  ON auth_attempts(bucket_key, occurred_at);

CREATE INDEX IF NOT EXISTS idx_auth_attempts_subject_occurred
  ON auth_attempts(subject_key, occurred_at);

CREATE INDEX IF NOT EXISTS idx_auth_failure_buckets_locked_until
  ON auth_failure_buckets(locked_until);

INSERT INTO schema_migrations (version)
VALUES ('0002')
ON CONFLICT(version) DO NOTHING;
