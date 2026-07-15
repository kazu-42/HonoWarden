PRAGMA foreign_keys = ON;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  billing_email TEXT,
  plan_type INTEGER NOT NULL DEFAULT 0,
  public_key TEXT,
  private_key TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  use_totp INTEGER NOT NULL DEFAULT 1 CHECK (use_totp IN (0,1)),
  revision_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE organization_users (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT,
  email TEXT NOT NULL,
  org_key TEXT,
  status INTEGER NOT NULL DEFAULT 0,
  type INTEGER NOT NULL DEFAULT 2,
  permissions TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (organization_id, email)
);
CREATE INDEX idx_org_users_user ON organization_users(user_id, status);
CREATE INDEX idx_org_users_org ON organization_users(organization_id, status);

CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  encrypted_name TEXT NOT NULL,
  external_id TEXT,
  type INTEGER NOT NULL DEFAULT 0,
  revision_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX idx_collections_org ON collections(organization_id);

CREATE TABLE collection_users (
  collection_id TEXT NOT NULL,
  organization_user_id TEXT NOT NULL,
  read_only INTEGER NOT NULL DEFAULT 0,
  hide_passwords INTEGER NOT NULL DEFAULT 0,
  manage INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, organization_user_id),
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_user_id) REFERENCES organization_users(id) ON DELETE CASCADE
);

CREATE TABLE collection_ciphers (
  collection_id TEXT NOT NULL,
  cipher_id TEXT NOT NULL,
  PRIMARY KEY (collection_id, cipher_id),
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  FOREIGN KEY (cipher_id) REFERENCES ciphers(id) ON DELETE CASCADE
);

ALTER TABLE ciphers ADD COLUMN organization_id TEXT
  REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ciphers ADD COLUMN cipher_key TEXT;
CREATE INDEX idx_ciphers_org ON ciphers(organization_id);

INSERT INTO schema_migrations (version)
VALUES ('0014')
ON CONFLICT(version) DO NOTHING;
