PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_totp (
  user_id TEXT PRIMARY KEY,
  encrypted_secret TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  verified_at TEXT,
  last_accepted_step INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS totp_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  challenge_hash TEXT NOT NULL UNIQUE,
  device_identifier TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_totp_challenges_user_expires
  ON totp_challenges(user_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_totp_challenges_hash
  ON totp_challenges(challenge_hash);

INSERT INTO schema_migrations (version)
VALUES ('0003')
ON CONFLICT(version) DO NOTHING;
