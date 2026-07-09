PRAGMA foreign_keys = ON;

ALTER TABLE users
  ADD COLUMN equivalent_domains TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(equivalent_domains));

ALTER TABLE users
  ADD COLUMN excluded_global_equivalent_domains TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(excluded_global_equivalent_domains));

INSERT INTO schema_migrations (version)
VALUES ('0010')
ON CONFLICT(version) DO NOTHING;
