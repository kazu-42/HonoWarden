-- Bind each policy write to its required same-batch audit, including ignored inserts.
ALTER TABLE organization_policies ADD COLUMN last_mutation_id TEXT
  CHECK (last_mutation_id IS NULL OR length(last_mutation_id) = 36);

INSERT INTO schema_migrations (version)
VALUES ('0030')
ON CONFLICT(version) DO NOTHING;
