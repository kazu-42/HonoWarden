import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const migrationPath = fileURLToPath(
  new URL(
    '../migrations/0021_emergency_access.sql',
    import.meta.url,
  ).toString(),
)

describe('emergency access invitation migration', () => {
  it('stores relationship state without raw invite tokens or recovery secrets', () => {
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toContain('CREATE TABLE emergency_access')
    expect(sql).toContain('grantor_user_id TEXT NOT NULL')
    expect(sql).toContain('grantee_user_id TEXT')
    expect(sql).toContain('email_normalized TEXT')
    expect(sql).toContain('invite_token_hash TEXT')
    expect(sql).toContain("invite_token_hash LIKE 'hmac-sha256:v1:%'")
    expect(sql).toContain('key_encrypted TEXT')
    expect(sql).toContain('key_generation INTEGER')
    expect(sql).toContain('wait_time_days INTEGER NOT NULL')
    expect(sql).toContain('idx_emergency_access_grantor_email_invited')
    expect(sql).toContain('idx_emergency_access_grantor_grantee')
    expect(sql).toContain("VALUES ('0021')")
    expect(sql).not.toMatch(/\binvite_token\s+TEXT\b/iu)
    expect(sql).not.toMatch(/\bplaintext\b/iu)
    expect(sql).not.toMatch(/\brecovery_secret\b/iu)
  })
})
