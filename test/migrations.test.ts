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
].join('\n')
