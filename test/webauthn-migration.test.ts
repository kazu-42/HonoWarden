import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const migrationPath = fileURLToPath(
  new URL('../migrations/0015_webauthn.sql', import.meta.url).toString(),
)

describe('WebAuthn credential and challenge migration', () => {
  it('stores owner credentials and hashed purpose-bound challenges without reusable secrets', () => {
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toContain('CREATE TABLE webauthn_credentials')
    expect(sql).toContain('user_id TEXT NOT NULL')
    expect(sql).toContain('credential_id TEXT NOT NULL UNIQUE')
    expect(sql).toContain('public_key TEXT NOT NULL')
    expect(sql).toContain('user_handle TEXT NOT NULL')
    expect(sql).toContain('sign_count INTEGER NOT NULL')
    expect(sql).toContain('CHECK (sign_count >= 0)')
    expect(sql).toContain(
      "credential_type TEXT NOT NULL CHECK (credential_type IN ('public-key'))",
    )
    expect(sql).toContain('transports TEXT NOT NULL')
    expect(sql).toContain('CHECK (json_valid(transports))')
    expect(sql).toContain('aaguid TEXT NOT NULL')
    expect(sql).toContain('discoverable INTEGER NOT NULL')
    expect(sql).toContain('backup_eligible INTEGER NOT NULL')
    expect(sql).toContain('backup_state INTEGER NOT NULL')
    expect(sql).toContain('prf_supported INTEGER NOT NULL')
    expect(sql).toContain('encrypted_user_key TEXT')
    expect(sql).toContain('encrypted_public_key TEXT')
    expect(sql).toContain('encrypted_private_key TEXT')
    expect(sql).toContain('name TEXT NOT NULL')
    expect(sql).toContain('last_used_at TEXT')
    expect(sql).toContain(
      'FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE',
    )
    expect(sql).toContain('CREATE INDEX idx_webauthn_credentials_user_revision')

    expect(sql).toContain('CREATE TABLE webauthn_challenges')
    expect(sql).toContain('token_hash TEXT NOT NULL UNIQUE')
    expect(sql).toContain('challenge_hash TEXT NOT NULL')
    expect(sql).toContain(
      "purpose TEXT NOT NULL CHECK (purpose IN ('registration', 'authentication', 'prf_key_set'))",
    )
    expect(sql).toContain('rp_id TEXT NOT NULL')
    expect(sql).toContain('origin_policy_version TEXT NOT NULL')
    expect(sql).toContain('expires_at TEXT NOT NULL')
    expect(sql).toContain('consumed_at TEXT')
    expect(sql).toContain('retention_delete_after TEXT NOT NULL')
    expect(sql).toContain('CREATE INDEX idx_webauthn_challenges_retention')
    expect(sql).toContain("VALUES ('0015')")
    expect(sql).not.toMatch(/\bchallenge\s+TEXT\b/i)
    expect(sql).not.toMatch(/\btoken\s+TEXT\b/i)
    expect(sql).not.toContain('prf_output')
    expect(sql).not.toContain('client_data')
    expect(sql).not.toContain('authenticator_data')
  })
})
