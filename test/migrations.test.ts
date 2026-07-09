import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const migration = readFileSync('migrations/0001_initial_schema.sql', 'utf8')

describe('initial D1 migration', () => {
  it('creates the minimum Week 2 schema tables', () => {
    for (const tableName of [
      'schema_migrations',
      'users',
      'devices',
      'refresh_tokens',
      'folders',
      'ciphers',
      'auth_attempts',
      'auth_failure_buckets',
      'request_quota_buckets',
    ]) {
      expect(allMigrations).toContain(`CREATE TABLE IF NOT EXISTS ${tableName}`)
    }
  })

  it('records the application schema version', () => {
    expect(migration).toContain('INSERT INTO schema_migrations')
    expect(migration).toContain("'0001'")
  })

  it('creates lookup and sync indexes', () => {
    for (const indexName of [
      'idx_users_email_normalized',
      'idx_devices_user_id',
      'idx_refresh_tokens_user_device',
      'idx_refresh_tokens_expires_at',
      'idx_folders_user_revision',
      'idx_ciphers_user_revision',
      'idx_ciphers_user_deleted',
      'idx_auth_attempts_bucket_occurred',
      'idx_auth_attempts_subject_occurred',
      'idx_auth_failure_buckets_locked_until',
      'idx_request_quota_buckets_blocked_until',
      'idx_request_quota_buckets_scope_updated',
    ]) {
      expect(allMigrations).toContain(`CREATE INDEX IF NOT EXISTS ${indexName}`)
    }
  })

  it('adds login defense state without plaintext IP storage', () => {
    expect(allMigrations).toContain('login_failed_count INTEGER NOT NULL')
    expect(allMigrations).toContain('login_failed_at TEXT')
    expect(allMigrations).toContain('login_locked_until TEXT')
    expect(allMigrations).toContain('bucket_key TEXT NOT NULL')
    expect(allMigrations).toContain('failed_count INTEGER NOT NULL')
    expect(allMigrations).toContain('window_started_at TEXT NOT NULL')
    expect(allMigrations).not.toContain('ip_address')
    expect(allMigrations).not.toContain('client_ip')
  })

  it('adds request quota buckets without plaintext IP storage', () => {
    expect(allMigrations).toContain(
      'CREATE TABLE IF NOT EXISTS request_quota_buckets',
    )
    expect(allMigrations).toContain('scope TEXT NOT NULL')
    expect(allMigrations).toContain('request_count INTEGER NOT NULL')
    expect(allMigrations).toContain('window_started_at TEXT NOT NULL')
    expect(allMigrations).toContain('blocked_until TEXT')
    expect(allMigrations).toContain(
      'CREATE INDEX IF NOT EXISTS idx_request_quota_buckets_blocked_until',
    )
    expect(allMigrations).toContain(
      'CREATE INDEX IF NOT EXISTS idx_request_quota_buckets_scope_updated',
    )
    expect(allMigrations).toContain("VALUES ('0008')")
    expect(allMigrations).not.toContain('ip_address')
    expect(allMigrations).not.toContain('client_ip')
  })

  it('adds owner-scoped equivalent-domain metadata on user rows', () => {
    expect(allMigrations).toContain(
      'ALTER TABLE users\n  ADD COLUMN equivalent_domains TEXT NOT NULL DEFAULT',
    )
    expect(allMigrations).toContain(
      'ALTER TABLE users\n  ADD COLUMN excluded_global_equivalent_domains TEXT NOT NULL DEFAULT',
    )
    expect(allMigrations).toContain('CHECK (json_valid(equivalent_domains))')
    expect(allMigrations).toContain(
      'CHECK (json_valid(excluded_global_equivalent_domains))',
    )
    expect(allMigrations).toContain("VALUES ('0010')")
  })

  it('adds TOTP persistence tables for setup and challenge flow', () => {
    expect(allMigrations).toContain('CREATE TABLE IF NOT EXISTS user_totp')
    expect(allMigrations).toContain(
      'CREATE TABLE IF NOT EXISTS totp_challenges',
    )
    expect(allMigrations).toContain('encrypted_secret TEXT NOT NULL')
    expect(allMigrations).toContain('enabled INTEGER NOT NULL DEFAULT 0')
    expect(allMigrations).toContain('verified_at TEXT')
    expect(allMigrations).toContain('last_accepted_step INTEGER')
    expect(allMigrations).toContain('challenge_hash TEXT NOT NULL UNIQUE')
    expect(allMigrations).toContain('device_identifier TEXT NOT NULL')
    expect(allMigrations).toContain('consumed_at TEXT')
    expect(allMigrations).toContain(
      'CREATE INDEX IF NOT EXISTS idx_totp_challenges_user_expires',
    )
    expect(allMigrations).toContain(
      'CREATE INDEX IF NOT EXISTS idx_totp_challenges_hash',
    )
    expect(allMigrations).toContain("VALUES ('0003')")
  })

  it('adds pending TOTP change state without modifying frozen migrations', () => {
    expect(allMigrations).toContain(
      'ALTER TABLE user_totp\n  ADD COLUMN pending_encrypted_secret TEXT',
    )
    expect(allMigrations).toContain(
      'ALTER TABLE user_totp\n  ADD COLUMN pending_created_at TEXT',
    )
    expect(allMigrations).toContain("VALUES ('0004')")
  })

  it('adds encrypted device key columns for trusted-device compatibility', () => {
    expect(allMigrations).toContain(
      'ALTER TABLE devices\n  ADD COLUMN encrypted_user_key TEXT',
    )
    expect(allMigrations).toContain(
      'ALTER TABLE devices\n  ADD COLUMN encrypted_public_key TEXT',
    )
    expect(allMigrations).toContain(
      'ALTER TABLE devices\n  ADD COLUMN encrypted_private_key TEXT',
    )
    expect(allMigrations).toContain("VALUES ('0005')")
  })

  it('adds owner-scoped cipher attachment metadata for R2 objects', () => {
    expect(allMigrations).toContain(
      'CREATE TABLE IF NOT EXISTS cipher_attachments',
    )
    expect(allMigrations).toContain('user_id TEXT NOT NULL')
    expect(allMigrations).toContain('cipher_id TEXT NOT NULL')
    expect(allMigrations).toContain('object_key TEXT NOT NULL UNIQUE')
    expect(allMigrations).toContain('file_name TEXT NOT NULL')
    expect(allMigrations).toContain('attachment_key TEXT NOT NULL')
    expect(allMigrations).toContain('size INTEGER NOT NULL')
    expect(allMigrations).toContain(
      'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
    )
    expect(allMigrations).toContain(
      'FOREIGN KEY (cipher_id) REFERENCES ciphers(id) ON DELETE CASCADE',
    )
    expect(allMigrations).toContain(
      'CREATE INDEX IF NOT EXISTS idx_cipher_attachments_user_cipher',
    )
    expect(allMigrations).toContain(
      'CREATE INDEX IF NOT EXISTS idx_cipher_attachments_user_revision',
    )
    expect(allMigrations).toContain("VALUES ('0006')")
  })

  it('adds secret-safe audit event persistence without plaintext IP storage', () => {
    expect(allMigrations).toContain('CREATE TABLE IF NOT EXISTS audit_events')
    expect(allMigrations).toContain('schema_version INTEGER NOT NULL')
    expect(allMigrations).toContain('name TEXT NOT NULL')
    expect(allMigrations).toContain('outcome TEXT NOT NULL')
    expect(allMigrations).toContain('request_id TEXT NOT NULL')
    expect(allMigrations).toContain('actor_user_id TEXT')
    expect(allMigrations).toContain('actor_device_identifier TEXT')
    expect(allMigrations).toContain('target_type TEXT')
    expect(allMigrations).toContain('context_json TEXT')
    expect(allMigrations).toContain(
      'CREATE INDEX IF NOT EXISTS idx_audit_events_occurred_at',
    )
    expect(allMigrations).toContain(
      'CREATE INDEX IF NOT EXISTS idx_audit_events_name_occurred',
    )
    expect(allMigrations).toContain(
      'CREATE INDEX IF NOT EXISTS idx_audit_events_actor_occurred',
    )
    expect(allMigrations).toContain(
      'CREATE INDEX IF NOT EXISTS idx_audit_events_request_id',
    )
    expect(allMigrations).toContain("VALUES ('0007')")
    expect(allMigrations).not.toContain('ip_address')
    expect(allMigrations).not.toContain('client_ip')
  })

  it('stores vault records as encrypted payloads', () => {
    expect(allMigrations).toContain('encrypted_name TEXT NOT NULL')
    expect(allMigrations).toContain('encrypted_json TEXT NOT NULL')
    expect(allMigrations).not.toContain('password TEXT')
    expect(allMigrations).not.toContain('uri TEXT')
  })
})

const allMigrations = [
  readFileSync('migrations/0001_initial_schema.sql', 'utf8'),
  readFileSync('migrations/0002_login_defenses.sql', 'utf8'),
  readFileSync('migrations/0003_totp_login.sql', 'utf8'),
  readFileSync('migrations/0004_totp_change.sql', 'utf8'),
  readFileSync('migrations/0005_device_keys.sql', 'utf8'),
  readFileSync('migrations/0006_cipher_attachments.sql', 'utf8'),
  readFileSync('migrations/0007_audit_events.sql', 'utf8'),
  readFileSync('migrations/0008_request_quotas.sql', 'utf8'),
  readFileSync('migrations/0010_equivalent_domains.sql', 'utf8'),
].join('\n')
