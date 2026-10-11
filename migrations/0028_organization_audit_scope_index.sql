-- Index only event-time organization attribution; never infer it from mutable targets.
CREATE INDEX idx_organization_audit_scope_occurred
  ON audit_events (
    CASE
      WHEN json_valid(context_json)
      THEN CASE
        WHEN json_type(context_json) = 'object'
          AND json_type(context_json, '$.organizationId') = 'text'
        THEN json_extract(context_json, '$.organizationId')
        ELSE NULL
      END
      ELSE NULL
    END,
    occurred_at DESC,
    id DESC
  );

INSERT INTO schema_migrations (version)
VALUES ('0028')
ON CONFLICT(version) DO NOTHING;
