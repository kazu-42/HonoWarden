PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inquiry_threads (
  id TEXT PRIMARY KEY,
  mailbox TEXT NOT NULL,
  thread_key TEXT NOT NULL,
  sender_hash TEXT NOT NULL,
  subject_preview TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed', 'rejected')),
  retention_deadline TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (mailbox, thread_key)
);

CREATE INDEX IF NOT EXISTS idx_inquiry_threads_mailbox_status
  ON inquiry_threads(mailbox, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_inquiry_threads_retention
  ON inquiry_threads(retention_deadline);

CREATE TABLE IF NOT EXISTS inquiry_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  envelope_sender_hash TEXT NOT NULL,
  envelope_recipient TEXT NOT NULL,
  message_id_hash TEXT,
  in_reply_to_hash TEXT,
  references_hash TEXT,
  subject_preview TEXT,
  raw_size INTEGER NOT NULL CHECK (raw_size >= 0),
  content_type TEXT,
  has_attachment_hint INTEGER NOT NULL DEFAULT 0 CHECK (has_attachment_hint IN (0, 1)),
  body_storage_state TEXT NOT NULL CHECK (body_storage_state IN ('metadata_only')),
  raw_body_stored INTEGER NOT NULL DEFAULT 0 CHECK (raw_body_stored IN (0, 1)),
  raw_object_key TEXT,
  attachment_storage_state TEXT NOT NULL CHECK (attachment_storage_state IN ('none', 'rejected')),
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('stored', 'forwarded', 'rejected')),
  rejection_reason TEXT,
  forward_attempted INTEGER NOT NULL DEFAULT 0 CHECK (forward_attempted IN (0, 1)),
  forwarded_at TEXT,
  received_at TEXT NOT NULL,
  retention_deadline TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (thread_id) REFERENCES inquiry_threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inquiry_messages_thread_received
  ON inquiry_messages(thread_id, received_at);

CREATE INDEX IF NOT EXISTS idx_inquiry_messages_retention
  ON inquiry_messages(retention_deadline);

CREATE INDEX IF NOT EXISTS idx_inquiry_messages_delivery_status
  ON inquiry_messages(delivery_status, received_at);

CREATE TABLE IF NOT EXISTS inquiry_events (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  message_id TEXT,
  name TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  occurred_at TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (thread_id) REFERENCES inquiry_threads(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES inquiry_messages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_inquiry_events_thread_occurred
  ON inquiry_events(thread_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_inquiry_events_name_occurred
  ON inquiry_events(name, occurred_at);

INSERT INTO schema_migrations (version)
VALUES ('0011')
ON CONFLICT(version) DO NOTHING;
