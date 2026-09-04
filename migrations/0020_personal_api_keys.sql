PRAGMA foreign_keys = ON;

CREATE TABLE personal_api_keys (
  user_id TEXT PRIMARY KEY,
  secret_verifier TEXT NOT NULL
    CHECK (secret_verifier LIKE 'hmac-sha256:v1:%'),
  created_at TEXT NOT NULL,
  rotated_at TEXT,
  last_used_at TEXT,
  revision_date TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO schema_migrations (version)
VALUES ('0020')
ON CONFLICT(version) DO NOTHING;
