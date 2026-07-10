PRAGMA foreign_keys = ON;

ALTER TABLE inquiry_messages RENAME TO legacy_inquiry_messages_0009;

DROP INDEX IF EXISTS idx_inquiry_messages_mailbox_received;
DROP INDEX IF EXISTS idx_inquiry_messages_retention;
DROP INDEX IF EXISTS idx_inquiry_messages_subject_sha256;
DROP INDEX IF EXISTS idx_inquiry_messages_message_id_sha256;

CREATE INDEX IF NOT EXISTS idx_legacy_inquiry_messages_mailbox_received
  ON legacy_inquiry_messages_0009(mailbox, received_at);

CREATE INDEX IF NOT EXISTS idx_legacy_inquiry_messages_retention
  ON legacy_inquiry_messages_0009(retention_delete_after);

CREATE INDEX IF NOT EXISTS idx_legacy_inquiry_messages_subject_sha256
  ON legacy_inquiry_messages_0009(subject_sha256);

CREATE INDEX IF NOT EXISTS idx_legacy_inquiry_messages_message_id_sha256
  ON legacy_inquiry_messages_0009(message_id_sha256);

INSERT INTO schema_migrations (version)
VALUES ('0010a')
ON CONFLICT(version) DO NOTHING;
