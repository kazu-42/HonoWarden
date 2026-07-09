PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cipher_attachments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  cipher_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  attachment_key TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  content_type TEXT,
  revision_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (cipher_id) REFERENCES ciphers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cipher_attachments_user_cipher
  ON cipher_attachments(user_id, cipher_id);

CREATE INDEX IF NOT EXISTS idx_cipher_attachments_user_revision
  ON cipher_attachments(user_id, revision_date, id);

INSERT INTO schema_migrations (version)
VALUES ('0006')
ON CONFLICT(version) DO NOTHING;
