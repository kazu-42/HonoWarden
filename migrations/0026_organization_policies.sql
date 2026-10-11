PRAGMA foreign_keys = ON;

-- Only the required-TOTP policy is implemented. Missing rows are disabled.
CREATE TABLE organization_policies (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  type INTEGER NOT NULL CHECK (type = 0),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  revision_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  UNIQUE (organization_id, type)
);

INSERT INTO schema_migrations (version)
VALUES ('0026')
ON CONFLICT(version) DO NOTHING;
