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
].join('\n')
