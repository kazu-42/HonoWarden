PRAGMA foreign_keys = ON;

CREATE TABLE user_key_rotation_wrapper_history (
  user_id TEXT NOT NULL,
  wrapper_kind TEXT NOT NULL
    CHECK (wrapper_kind IN ('user_key', 'private_key')),
  wrapper_sha256 TEXT NOT NULL
    CHECK (
      length(wrapper_sha256) = 64 AND
      wrapper_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (user_id, wrapper_sha256),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) WITHOUT ROWID;

INSERT INTO schema_migrations (version)
VALUES ('0016')
ON CONFLICT(version) DO NOTHING;
