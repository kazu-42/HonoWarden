import { describe, expect, it } from 'vitest'

import {
  completeOwnerFileSendUpload,
  createOwnerFileSend,
  issueOwnerFileDownloadTicket,
} from '../src/send-file-owner'

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

class MutationDatabase {
  readonly calls: RecordedStatement[] = []

  constructor(
    private readonly firstRow: unknown | null,
    private readonly changes = 1,
  ) {}

  prepare(query: string): D1PreparedStatement {
    const record = { query, bindings: [] as unknown[] }
    const statement = {
      bind: (...bindings: unknown[]) => {
        record.bindings = bindings
        return statement as unknown as D1PreparedStatement
      },
      first: async () => {
        this.calls.push(record)
        return this.firstRow
      },
    }
    return statement as unknown as D1PreparedStatement
  }
}

describe('file Send upload completion', () => {
  it('activates only the matching pending generation after size verification', async () => {
    const active = {
      id: 'file-1',
      sendId: 'send-1',
      ownerUserId: 'user-1',
      objectGeneration: 1,
      objectKey: 'sends/send-1/files/file-1/g1/aa',
      encryptedFileName: 'opaque-file-name',
      expectedSize: 4096,
      observedSize: 4096,
      objectEtag: 'etag-1',
      lifecycleState: 'active',
      uploadDeadlineAt: '2026-09-02T07:00:00.000Z',
      validatedAt: now,
      cleanupLeaseUntil: null,
      cleanupAttempts: 0,
      lastFailureClass: null,
      deletedAt: null,
    }
    const database = new MutationDatabase(active)
    const result = await completeOwnerFileSendUpload(
      database as unknown as D1Database,
      {
        id: 'file-1',
        sendId: 'send-1',
        ownerUserId: 'user-1',
        objectGeneration: 1,
        objectKey: 'sends/send-1/files/file-1/g1/aa',
        observedSize: 4096,
        expectedSize: 4096,
        objectEtag: 'etag-1',
        now,
      },
    )

    expect(result).toEqual({ status: 'activated', file: active })
    expect(database.calls[0]?.query).toContain("lifecycle_state = 'active'")
    expect(database.calls[0]?.query).toContain(
      "lifecycle_state = 'pending_upload'",
    )
  })

  it('does not activate when the observed size does not match expected size', async () => {
    const database = new MutationDatabase(null, 0)
    const result = await completeOwnerFileSendUpload(
      database as unknown as D1Database,
      {
        id: 'file-1',
        sendId: 'send-1',
        ownerUserId: 'user-1',
        objectGeneration: 1,
        objectKey: 'sends/send-1/files/file-1/g1/aa',
        observedSize: 1024,
        expectedSize: 4096,
        objectEtag: 'etag-1',
        now,
      },
    )

    expect(result).toEqual({ status: 'size_mismatch' })
    expect(database.calls).toEqual([])
  })

  it('issues a download ticket only after consuming file access, without storing the raw ticket', async () => {
    const consumedSend = { id: 'send-1', accessCount: 1, type: 1 }
    const ticketRow = {
      ticketVerifier: 'ab'.repeat(32),
      sendId: 'send-1',
      fileId: 'file-1',
      accessGeneration: 2,
      objectGeneration: 1,
      expiresAt: '2026-09-02T06:41:00.000Z',
      maxRequests: 3,
      remainingBytes: 4096,
      consumedRequests: 0,
    }
    const rows = [consumedSend, ticketRow]
    const database = new SequencingDatabase(rows)
    const result = await issueOwnerFileDownloadTicket(
      database as unknown as D1Database,
      {
        capabilityVerifier: 'cd'.repeat(32),
        accessGeneration: 2,
        sendId: 'send-1',
        fileId: 'file-1',
        objectGeneration: 1,
        remainingBytes: 4096,
        lookupKeyId: 'ticket-key-1',
        lookupSecret: 'lookup-secret-1'.padEnd(32, 'x'),
        now,
        randomBytes: (bytes) => {
          bytes.fill(9)
          return bytes
        },
      },
    )

    expect(result.status).toBe('issued')
    if (result.status !== 'issued') throw new Error('expected issued')
    expect(result.ticketId).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(result.url).toBe(`/api/sends/access/file-content/${result.ticketId}`)
    const writes = JSON.stringify(database.calls)
    expect(writes).toContain('access_count = access_count + 1')
    expect(writes).toContain('INSERT INTO send_download_tickets')
    expect(writes).not.toContain(result.ticketId)
    expect(writes).not.toContain('send-1/files')
  })
})

class SequencingDatabase {
  readonly calls: RecordedStatement[] = []

  constructor(private readonly rows: unknown[]) {}

  prepare(query: string): D1PreparedStatement {
    const record = { query, bindings: [] as unknown[] }
    const statement = {
      bind: (...bindings: unknown[]) => {
        record.bindings = bindings
        return statement as unknown as D1PreparedStatement
      },
      first: async () => {
        this.calls.push(record)
        return this.rows.shift() ?? null
      },
    }
    return statement as unknown as D1PreparedStatement
  }
}
