PRAGMA foreign_keys = ON;

CREATE UNIQUE INDEX idx_org_users_id_org ON organization_users(id, organization_id);
CREATE UNIQUE INDEX idx_collections_id_org ON collections(id, organization_id);

CREATE TABLE organization_groups (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  revision_date TEXT NOT NULL,
  last_mutation_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  UNIQUE (id, organization_id)
);
CREATE INDEX idx_org_groups_org ON organization_groups(organization_id, id);

CREATE TABLE organization_group_users (
  group_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  organization_user_id TEXT NOT NULL,
  PRIMARY KEY (group_id, organization_user_id),
  FOREIGN KEY (group_id, organization_id)
    REFERENCES organization_groups(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_user_id, organization_id)
    REFERENCES organization_users(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX idx_group_users_member
  ON organization_group_users(organization_user_id, organization_id, group_id);

CREATE TABLE collection_groups (
  collection_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  read_only INTEGER NOT NULL DEFAULT 0 CHECK (read_only IN (0, 1)),
  hide_passwords INTEGER NOT NULL DEFAULT 0 CHECK (hide_passwords IN (0, 1)),
  manage INTEGER NOT NULL DEFAULT 0 CHECK (manage IN (0, 1)),
  PRIMARY KEY (group_id, collection_id),
  FOREIGN KEY (group_id, organization_id)
    REFERENCES organization_groups(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (collection_id, organization_id)
    REFERENCES collections(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX idx_collection_groups_collection
  ON collection_groups(collection_id, organization_id, group_id);

INSERT INTO schema_migrations (version)
VALUES ('0025')
ON CONFLICT(version) DO NOTHING;
