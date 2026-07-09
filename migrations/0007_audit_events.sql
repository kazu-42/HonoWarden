PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  name TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  request_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  actor_user_id TEXT,
  actor_device_identifier TEXT,
  target_type TEXT,
  target_id TEXT,
  context_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_events_occurred_at
  ON audit_events(occurred_at);

CREATE INDEX IF NOT EXISTS idx_audit_events_name_occurred
  ON audit_events(name, occurred_at);

CREATE INDEX IF NOT EXISTS idx_audit_events_actor_occurred
  ON audit_events(actor_user_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_audit_events_request_id
  ON audit_events(request_id);

INSERT INTO schema_migrations (version)
VALUES ('0007')
ON CONFLICT(version) DO NOTHING;
