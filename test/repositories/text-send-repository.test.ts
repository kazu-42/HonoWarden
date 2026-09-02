import { describe, expect, it } from 'vitest'

import {
  consumeTextSendAccess,
  createTextSend,
  deleteTextSend,
  listOwnerTextSends,
  removeTextSendAuth,
  updateTextSend,
} from '../../src/repositories/text-send-repository'
import type { TextSendRow } from '../../src/repositories/text-send-repository'

type RecordedStatement = { query: string; bindings: unknown[] }

const fakeMeta = {
  duration: 0,
  size_after: 0,
  rows_read: 0,
  rows_written: 1,
  last_row_id: 1,
  changed_db: true,
  changes: 1,
} satisfies D1Meta & Record<string, unknown>

class RecordingDatabase {
  readonly calls: RecordedStatement[] = []
  readonly batchCalls: RecordedStatement[][] = []
  private readonly records = new WeakMap<object, RecordedStatement>()

  constructor(
    private readonly rows: unknown[] = [],
    private readonly batchChanges: number[] = [1, 1],
  ) {}

  prepare(query: string): D1PreparedStatement {
    const record = { query, bindings: [] as unknown[] }
    const statement = {
      bind: (...bindings: unknown[]) => {
        record.bindings = bindings
        return statement as unknown as D1PreparedStatement
      },
      all: async () => {
        this.calls.push(record)
        return { success: true, results: this.rows, meta: fakeMeta }
      },
      first: async () => {
        this.calls.push(record)
        return this.rows[0] ?? null
      },
      run: async () => {
        this.calls.push(record)
        return { success: true, results: this.rows, meta: fakeMeta }
      },
    }
    this.records.set(statement, record)
    return statement as unknown as D1PreparedStatement
  }

  async batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    const records = statements.map((statement) => {
      const record = this.records.get(statement as object)
      if (!record) throw new Error('unrecorded statement')
      return record
    })
    this.batchCalls.push(records)
    return records.map((_, index) => ({
      success: true,
      results: (index === 0 ? this.rows : []) as T[],
      meta: { ...fakeMeta, changes: this.batchChanges[index] ?? 0 },
    }))
  }
}

const row: TextSendRow = {
  id: 'send-1',
  ownerUserId: 'user-1',
  type: 0,
  authType: 1,
  lifecycleState: 'active',
  capabilityEnvelope: 'envelope',
  capabilityEnvelopeKeyId: 'envelope-v1',
  capabilityVerifier: 'a'.repeat(64),
  capabilityVerifierKeyId: 'lookup-v1',
  accessGeneration: 1,
  encryptedName: 'name',
  encryptedNotes: 'notes',
  encryptedKey: 'key',
  encryptedText: 'text',
  textHidden: 0,
  passwordVerifier: 'b'.repeat(64),
  passwordKeyId: 'lookup-v1',
  maxAccessCount: 5,
  accessCount: 0,
  disabled: 0,
  hideEmail: 1,
  expirationAt: null,
  deletionAt: '2026-08-20T00:00:00.000Z',
  revisionDate: '2026-08-08T00:00:00.000Z',
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
  deletedAt: null,
  quarantinedAt: null,
  lastAccessedAt: null,
}

describe('text Send repository', () => {
  it('creates one owner row and redacted audit event in one batch', async () => {
    const database = new RecordingDatabase([row])
    const input = { ...row, auditEventId: 'audit-1', requestId: 'request-1' }

    await expect(
      createTextSend(database as unknown as D1Database, input),
    ).resolves.toEqual({ status: 'created', send: row })
    expect(database.batchCalls).toHaveLength(1)
    expect(database.batchCalls[0]?.[0]?.query).toContain('INSERT INTO sends')
    expect(database.batchCalls[0]?.[0]?.query).toContain('RETURNING')
    expect(database.batchCalls[0]?.[1]?.query).toContain(
      'INSERT INTO audit_events',
    )
    expect(JSON.stringify(database.batchCalls)).not.toContain('raw-access-id')
    expect(JSON.stringify(database.batchCalls)).not.toContain(
      'client-derived-hash',
    )
  })

  it('lists only non-deleted text rows for the authenticated owner', async () => {
    const database = new RecordingDatabase([row])

    await expect(
      listOwnerTextSends(database as unknown as D1Database, 'user-1'),
    ).resolves.toEqual([row])
    expect(database.calls[0]?.query).toContain('owner_user_id = ?')
    expect(database.calls[0]?.query).toContain('deleted_at IS NULL')
    expect(database.calls[0]?.query).toContain('type = 0')
  })

  it('updates by owner and revision while advancing the access generation', async () => {
    const database = new RecordingDatabase([
      {
        ...row,
        accessGeneration: 2,
        revisionDate: '2026-08-08T00:00:01.000Z',
        updatedAt: '2026-08-08T00:00:01.000Z',
      },
    ])

    await expect(
      updateTextSend(database as unknown as D1Database, {
        id: 'send-1',
        ownerUserId: 'user-1',
        expectedRevisionDate: row.revisionDate,
        encryptedName: 'next-name',
        encryptedNotes: null,
        encryptedKey: 'next-key',
        encryptedText: 'next-text',
        textHidden: true,
        authType: 1,
        passwordVerifier: row.passwordVerifier,
        passwordKeyId: row.passwordKeyId,
        maxAccessCount: 5,
        disabled: false,
        hideEmail: true,
        expirationAt: null,
        deletionAt: row.deletionAt,
        nextRevisionDate: '2026-08-08T00:00:01.000Z',
      }),
    ).resolves.toMatchObject({ status: 'updated' })
    expect(database.calls[0]?.query).toContain(
      'access_generation = access_generation + 1',
    )
    expect(database.calls[0]?.query).toContain('owner_user_id = ?')
    expect(database.calls[0]?.query).toContain('revision_date = ?')
    expect(database.calls[0]?.query).toContain(
      'max_access_count IS NULL OR max_access_count >= access_count',
    )
    expect(database.calls[0]?.query).toContain('deleted_at IS NULL')
    expect(database.calls[0]?.query).toContain('quarantined_at IS NULL')
    expect(database.calls[0]?.query).toContain(
      "lifecycle_state IN ('active', 'disabled', 'expired')",
    )
  })

  it('removes authentication idempotently without incrementing an already-none row', async () => {
    const database = new RecordingDatabase([
      { ...row, authType: 2, passwordVerifier: null, passwordKeyId: null },
    ])

    await expect(
      removeTextSendAuth(database as unknown as D1Database, {
        id: 'send-1',
        ownerUserId: 'user-1',
        now: '2026-08-08T00:00:01.000Z',
      }),
    ).resolves.toMatchObject({ status: 'updated' })
    expect(database.calls[0]?.query).toContain('CASE WHEN auth_type = 2')
    expect(database.calls[0]?.query).toContain('password_verifier IS NULL')
    expect(database.calls[0]?.query).toContain('quarantined_at IS NULL')
    expect(database.calls[0]?.query).toContain(
      "lifecycle_state IN ('active', 'disabled', 'expired')",
    )
  })

  it('tombstones by owner and treats a retained owner tombstone as idempotent', async () => {
    const database = new RecordingDatabase([
      {
        ...row,
        lifecycleState: 'deleted',
        disabled: 1,
        deletedAt: '2026-08-08T00:00:01.000Z',
      },
    ])

    await expect(
      deleteTextSend(database as unknown as D1Database, {
        id: 'send-1',
        ownerUserId: 'user-1',
        now: '2026-08-08T00:00:01.000Z',
      }),
    ).resolves.toEqual({ status: 'deleted' })
    expect(database.calls[0]?.query).toContain(
      "THEN 'deleted' ELSE lifecycle_state END",
    )
    expect(database.calls[0]?.query).toContain(
      'THEN access_generation + 1 ELSE access_generation END',
    )
    expect(database.calls[0]?.query).toContain("lifecycle_state = 'deleted'")
    expect(database.calls[0]?.query).toContain('disabled = 1')
    expect(database.calls[0]?.query).toContain('deleted_at IS NULL')
    expect(database.calls[0]?.query).toContain('? > revision_date')
    expect(database.calls[0]?.query).toContain('owner_user_id = ?')
  })

  it('consumes text access with one generation/state/time/count guarded update', async () => {
    const database = new RecordingDatabase([{ ...row, accessCount: 1 }])

    await expect(
      consumeTextSendAccess(database as unknown as D1Database, {
        capabilityVerifier: row.capabilityVerifier,
        accessGeneration: 1,
        now: '2026-08-09T00:00:00.000Z',
      }),
    ).resolves.toEqual({ status: 'consumed', send: { ...row, accessCount: 1 } })
    expect(database.calls).toHaveLength(1)
    expect(database.calls[0]?.query).toContain('UPDATE sends')
    expect(database.calls[0]?.query).toContain(
      'access_count = access_count + 1',
    )
    expect(database.calls[0]?.query).toContain('capability_verifier = ?')
    expect(database.calls[0]?.query).toContain('access_generation = ?')
    expect(database.calls[0]?.query).toContain("lifecycle_state = 'active'")
    expect(database.calls[0]?.query).toContain('disabled = 0')
    expect(database.calls[0]?.query).toContain('quarantined_at IS NULL')
    expect(database.calls[0]?.query).toContain('deletion_at > ?')
    expect(database.calls[0]?.query).toContain(
      'expiration_at IS NULL OR expiration_at > ?',
    )
    expect(database.calls[0]?.query).toContain(
      'access_count < max_access_count',
    )
    expect(database.calls[0]?.query).toContain('RETURNING')
  })
})
