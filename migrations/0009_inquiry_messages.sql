PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS inquiry_messages (
  id TEXT PRIMARY KEY,
  mailbox TEXT NOT NULL,
  envelope_sender TEXT NOT NULL,
  envelope_sender_sha256 TEXT NOT NULL,
  envelope_recipient TEXT NOT NULL,
  message_id_sha256 TEXT,
  subject_sha256 TEXT,
  headers_json TEXT NOT NULL,
  header_count INTEGER NOT NULL CHECK (header_count >= 0),
  raw_size INTEGER NOT NULL CHECK (raw_size >= 0),
  body_metadata_json TEXT NOT NULL,
  body_storage_state TEXT NOT NULL CHECK (body_storage_state IN ('metadata_only')),
  raw_storage_state TEXT NOT NULL CHECK (raw_storage_state IN ('disabled')),
  attachment_storage_state TEXT NOT NULL CHECK (attachment_storage_state IN ('not_present', 'rejected', 'unknown')),
  attachment_count INTEGER CHECK (attachment_count IS NULL OR attachment_count >= 0),
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('stored', 'rejected')),
  reject_reason TEXT,
  received_at TEXT NOT NULL,
  retention_delete_after TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inquiry_messages_mailbox_received
  ON inquiry_messages(mailbox, received_at);

CREATE INDEX IF NOT EXISTS idx_inquiry_messages_retention
  ON inquiry_messages(retention_delete_after);

CREATE INDEX IF NOT EXISTS idx_inquiry_messages_subject_sha256
  ON inquiry_messages(subject_sha256);

CREATE INDEX IF NOT EXISTS idx_inquiry_messages_message_id_sha256
  ON inquiry_messages(message_id_sha256);

INSERT INTO schema_migrations (version)
VALUES ('0009')
ON CONFLICT(version) DO NOTHING;
