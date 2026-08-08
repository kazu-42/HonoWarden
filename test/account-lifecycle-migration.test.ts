import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const migrationPath = fileURLToPath(
  new URL(
    '../migrations/0017_account_lifecycle.sql',
    import.meta.url,
  ).toString(),
)

describe('account lifecycle migration', () => {
  it('stores only digest-bound tokens and an explicit recoverable deletion state', () => {
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toContain('ALTER TABLE users ADD COLUMN email_verified_at TEXT')
    expect(sql).toContain('CREATE TABLE account_lifecycle_tokens')
    expect(sql).toContain('token_digest TEXT NOT NULL UNIQUE')
    expect(sql).toContain("'email_change', 'email_verify', 'account_delete'")
    expect(sql).toContain('target_email_normalized TEXT')
    expect(sql).toContain('credential_generation TEXT NOT NULL')
    expect(sql).toContain('delivery_state TEXT NOT NULL')
    expect(sql).toContain('consumed_at TEXT')
    expect(sql).toContain('superseded_at TEXT')
    expect(sql).toContain('CREATE TABLE account_deletions')
    expect(sql).toContain('lifecycle_generation TEXT NOT NULL UNIQUE')
    expect(sql).toContain(
      "'recoverable', 'purge_ready', 'purging_r2', 'tombstoned', 'recovered'",
    )
    expect(sql).toContain('recover_until TEXT NOT NULL')
    expect(sql).toContain('purge_operation_id TEXT')
    expect(sql).toContain(
      'personal_r2_deleted_count INTEGER NOT NULL DEFAULT 0',
    )
    expect(sql).toContain(
      'CREATE UNIQUE INDEX idx_account_lifecycle_tokens_active_purpose',
    )
    expect(sql).not.toMatch(/\btoken\s+TEXT\b/i)
    expect(sql).not.toContain('master_password_hash')
    expect(sql).not.toContain('encrypted_json')
  })
})
