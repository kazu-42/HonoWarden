PRAGMA foreign_keys = ON;

CREATE TABLE organization_company_settings (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  default_email_domain TEXT CHECK (default_email_domain IS NULL OR length(default_email_domain) BETWEEN 1 AND 253),
  expected_member_count INTEGER CHECK (expected_member_count IS NULL OR expected_member_count BETWEEN 1 AND 100000),
  mail_test_recipient TEXT CHECK (mail_test_recipient IS NULL OR length(mail_test_recipient) BETWEEN 3 AND 254),
  revision TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO schema_migrations (version) VALUES ('0032') ON CONFLICT(version) DO NOTHING;
