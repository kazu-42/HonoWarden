import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const migrationPath = fileURLToPath(
  new URL('../migrations/0018_text_sends.sql', import.meta.url).toString(),
)

describe('text Send migration', () => {
  it('stores opaque text state without raw public capabilities or password inputs', () => {
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toContain('CREATE TABLE sends')
    expect(sql).toContain('owner_user_id TEXT NOT NULL')
    expect(sql).toContain('capability_envelope TEXT NOT NULL')
    expect(sql).toContain('capability_verifier TEXT NOT NULL UNIQUE')
    expect(sql).toContain('password_verifier TEXT')
    expect(sql).toContain('access_generation INTEGER NOT NULL')
    expect(sql).toContain('encrypted_name TEXT NOT NULL')
    expect(sql).toContain('encrypted_text TEXT')
    expect(sql).toContain('deletion_at TEXT NOT NULL')
    expect(sql).toContain('deleted_at TEXT')
    expect(sql).toContain(
      "lifecycle_state != 'quarantined' OR quarantined_at IS NOT NULL",
    )
    expect(sql).toContain('idx_sends_owner_active')
    expect(sql).toContain('idx_sends_retention')
    expect(sql).toContain("VALUES ('0018')")
    expect(sql).not.toMatch(/\baccess_id\s+TEXT\b/iu)
    expect(sql).not.toMatch(/\bpassword_hash\s+TEXT\b/iu)
    expect(sql).not.toMatch(/\bplaintext\b/iu)
  })
})
