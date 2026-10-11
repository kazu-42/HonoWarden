-- Internal nonce binds a lifecycle write to its mandatory same-batch audit.
ALTER TABLE organization_users ADD COLUMN last_membership_mutation_id TEXT
  CHECK (last_membership_mutation_id IS NULL OR length(last_membership_mutation_id) = 36);

INSERT INTO schema_migrations (version)
VALUES ('0029')
ON CONFLICT(version) DO NOTHING;
