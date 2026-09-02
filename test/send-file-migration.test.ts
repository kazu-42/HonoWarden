import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const migrationPath = fileURLToPath(
  new URL('../migrations/0019_send_files.sql', import.meta.url).toString(),
)

describe('file Send migration', () => {
  it('stores generation-bound file metadata without client object keys or ticket material', () => {
    const sql = readFileSync(migrationPath, 'utf8')

    expect(sql).toContain('CREATE TABLE send_files')
    expect(sql).toContain('send_id TEXT NOT NULL')
    expect(sql).toContain('owner_user_id TEXT NOT NULL')
    expect(sql).toContain('object_generation INTEGER NOT NULL')
    expect(sql).toContain('object_key TEXT NOT NULL UNIQUE')
    expect(sql).toContain('encrypted_file_name TEXT NOT NULL')
    expect(sql).toContain('expected_size INTEGER NOT NULL')
    expect(sql).toContain('observed_size INTEGER')
    expect(sql).toContain(
      "lifecycle_state IN ('pending_upload', 'active', 'deleted')",
    )
    expect(sql).toContain('upload_deadline_at TEXT NOT NULL')
    expect(sql).toContain('cleanup_lease_until TEXT')
    expect(sql).toContain('UNIQUE (send_id, object_generation)')
    expect(sql).toContain('CREATE TABLE send_download_tickets')
    expect(sql).toContain('ticket_verifier TEXT PRIMARY KEY')
    expect(sql).toContain('access_generation INTEGER NOT NULL')
    expect(sql).toContain("VALUES ('0019')")
    expect(sql).not.toMatch(/\bpresign/iu)
    expect(sql).not.toMatch(/\bobject_key_from_client\b/iu)
    expect(sql).not.toMatch(/\bticket_url\b/iu)
    expect(sql).not.toMatch(/\bplaintext\b/iu)
  })
})
