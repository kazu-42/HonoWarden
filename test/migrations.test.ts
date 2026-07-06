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
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${tableName}`)
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
    ]) {
      expect(migration).toContain(`CREATE INDEX IF NOT EXISTS ${indexName}`)
    }
  })

  it('stores vault records as encrypted payloads', () => {
    expect(migration).toContain('encrypted_name TEXT NOT NULL')
    expect(migration).toContain('encrypted_json TEXT NOT NULL')
    expect(migration).not.toContain('password TEXT')
    expect(migration).not.toContain('uri TEXT')
  })
})
