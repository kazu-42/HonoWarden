PRAGMA foreign_keys = ON;

-- Digest-only challenges bind EVP proof to one authenticated account family.
CREATE TABLE email_verification_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  device_identifier TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  security_stamp TEXT NOT NULL,
  audience TEXT NOT NULL,
  nonce_digest TEXT NOT NULL CHECK (length(nonce_digest) = 43),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  verification_mutation_id TEXT
    CHECK (verification_mutation_id IS NULL OR length(verification_mutation_id) = 36),
  UNIQUE (user_id, session_id),
  CHECK ((consumed_at IS NULL) = (verification_mutation_id IS NULL))
);

CREATE INDEX idx_email_verification_challenges_expiry
  ON email_verification_challenges(expires_at);

INSERT INTO schema_migrations (version)
VALUES ('0031')
ON CONFLICT(version) DO NOTHING;
