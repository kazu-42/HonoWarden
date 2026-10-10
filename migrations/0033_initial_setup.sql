PRAGMA foreign_keys = ON;

-- Intentionally no cascading foreign key: deleting the first account must
-- never reopen first-account setup. Restore this receipt with the vault backup.
CREATE TABLE initial_setup_receipt (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  user_id TEXT NOT NULL,
  consumed_at TEXT NOT NULL
);

INSERT INTO schema_migrations (version) VALUES ('0033') ON CONFLICT(version) DO NOTHING;
