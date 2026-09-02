import { describe, expect, it } from 'vitest'

import { createOwnerFileSend } from '../src/send-file-owner'

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

class OwnerServiceDatabase {
  readonly batchCalls: RecordedStatement[][] = []
  private readonly records = new WeakMap<object, RecordedStatement>()

  prepare(query: string): D1PreparedStatement {
    const record = { query, bindings: [] as unknown[] }
    const statement = {
      bind: (...bindings: unknown[]) => {
        record.bindings = bindings
        return statement as unknown as D1PreparedStatement
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
    return records.map((record) => ({
      success: true,
      results: record.query.includes('INSERT INTO sends')
        ? ([{ id: 'send-1', type: 1 }] as T[])
        : record.query.includes('INSERT INTO send_files')
          ? ([{ id: 'file-1', sendId: 'send-1' }] as T[])
          : [],
      meta: fakeMeta,
    }))
  }
}

const now = '2026-09-02T06:40:00.000Z'
const validBody = {
  type: 1,
  name: 'opaque-name',
  notes: null,
  key: 'opaque-key',
  file: { fileName: 'opaque-file-name' },
  fileLength: 4096,
  authtype: 2,
  password: null,
  emails: null,
  disabled: false,
  hideemail: true,
  maxaccesscount: 3,
  expirationdate: '2026-09-03T00:00:00.000Z',
  deletiondate: '2026-09-10T00:00:00.000Z',
}

describe('file Send owner application service', () => {
  it('creates pending file metadata without persisting the raw capability or a client object key', async () => {
    const database = new OwnerServiceDatabase()
    const result = await createOwnerFileSend(
      database as unknown as D1Database,
      {
        ownerUserId: 'user-1',
        body: validBody,
        now,
        sendId: 'send-1',
        fileId: 'file-1',
        auditEventId: 'audit-1',
        requestId: 'request-1',
        envelopeKeyId: 'envelope-v1',
        envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
        lookupKeyId: 'lookup-v1',
        lookupSecret: 'l'.repeat(32),
        randomBytes: (bytes) => {
          bytes.fill(7)
          return bytes
        },
      },
    )

    expect(result.status).toBe('created')
    if (result.status !== 'created') throw new Error('expected create')
    expect(result.send.Type).toBe(1)
    expect(result.send.Text).toBeNull()
    expect(result.send.File).toEqual({
      Id: 'file-1',
      FileName: 'opaque-file-name',
      Size: 4096,
    })
    expect(result.send.AccessId).toMatch(/^[A-Za-z0-9_-]{22}$/u)
    const writes = JSON.stringify(database.batchCalls)
    expect(writes).toContain('INSERT INTO sends')
    expect(writes).toContain('INSERT INTO send_files')
    expect(writes).toContain('pending_upload')
    expect(writes).not.toContain(result.send.AccessId)
    expect(writes).not.toMatch(/object_key_from_client/iu)
    expect(writes).not.toContain('client-key')
  })

  it('rejects a text payload on file create without touching D1', async () => {
    const database = new OwnerServiceDatabase()
    const result = await createOwnerFileSend(
      database as unknown as D1Database,
      {
        ownerUserId: 'user-1',
        body: { ...validBody, text: { text: 'opaque-text', hidden: false } },
        now,
        sendId: 'send-1',
        fileId: 'file-1',
        auditEventId: 'audit-1',
        requestId: 'request-1',
        envelopeKeyId: 'envelope-v1',
        envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
        lookupKeyId: 'lookup-v1',
        lookupSecret: 'l'.repeat(32),
      },
    )

    expect(result).toEqual({ status: 'invalid_request' })
    expect(database.batchCalls).toEqual([])
  })
})
