import { describe, expect, it } from 'vitest'

import {
  cleanupAbandonedSendFile,
  completeSendFileUpload,
  consumeFileSendAccess,
  consumeSendDownloadTicket,
  createPendingSendFile,
  createSendDownloadTicket,
  previewFileSendAccess,
  revokeSendFile,
} from '../../src/repositories/send-file-repository'

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
  private readonly records = new WeakMap<object, RecordedStatement>()

  constructor(
    private readonly firstRow: unknown | null = null,
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
      run: async () => {
        this.calls.push(record)
        return {
          success: true,
          results: [],
          meta: { ...fakeMeta, changes: this.changes },
        }
      },
    }
    this.records.set(statement, record)
    return statement as unknown as D1PreparedStatement
  }
}

const pendingFile = {
  id: 'file-1',
  sendId: 'send-1',
  ownerUserId: 'user-1',
  objectGeneration: 1,
  objectKey: 'sends/send-1/files/file-1/g1/aa',
  encryptedFileName: 'opaque-file-name',
  expectedSize: 4096,
  observedSize: null,
  objectEtag: null,
  lifecycleState: 'pending_upload' as const,
  uploadDeadlineAt: '2026-09-02T07:00:00.000Z',
  validatedAt: null,
  cleanupLeaseUntil: null,
  cleanupAttempts: 0,
  lastFailureClass: null,
  deletedAt: null,
}

describe('file Send repository', () => {
  it('creates pending file metadata bound to owner, generation, and server object key', async () => {
    const database = new RecordingDatabase(pendingFile)
    const result = await createPendingSendFile(database as never, {
      ...pendingFile,
      now: '2026-09-02T06:40:00.000Z',
    })

    expect(result).toEqual({ status: 'created', file: pendingFile })
    expect(database.calls[0]?.query).toContain('INSERT INTO send_files')
    expect(database.calls[0]?.bindings).toEqual([
      'file-1',
      'send-1',
      'user-1',
      1,
      'sends/send-1/files/file-1/g1/aa',
      'opaque-file-name',
      4096,
      'pending_upload',
      '2026-09-02T07:00:00.000Z',
    ])
    expect(database.calls[0]?.query).not.toMatch(/object_key_from_client/iu)
  })

  it('activates only the matching pending generation after size verification', async () => {
    const active = {
      ...pendingFile,
      observedSize: 4096,
      objectEtag: 'etag-1',
      lifecycleState: 'active',
      validatedAt: '2026-09-02T06:41:00.000Z',
    }
    const database = new RecordingDatabase(active)
    const result = await completeSendFileUpload(database as never, {
      id: 'file-1',
      sendId: 'send-1',
      ownerUserId: 'user-1',
      objectGeneration: 1,
      objectKey: 'sends/send-1/files/file-1/g1/aa',
      observedSize: 4096,
      objectEtag: 'etag-1',
      now: '2026-09-02T06:41:00.000Z',
    })

    expect(result).toEqual({ status: 'activated', file: active })
    expect(database.calls[0]?.query).toContain("lifecycle_state = 'active'")
    expect(database.calls[0]?.query).toContain(
      "lifecycle_state = 'pending_upload'",
    )
    expect(database.calls[0]?.query).toContain('object_generation = ?')
    expect(database.calls[0]?.bindings).toEqual([
      4096,
      'etag-1',
      '2026-09-02T06:41:00.000Z',
      'file-1',
      'send-1',
      'user-1',
      1,
      'sends/send-1/files/file-1/g1/aa',
      4096,
    ])
  })

  it('does not clean an abandoned object when the generation no longer matches', async () => {
    const database = new RecordingDatabase(null, 0)
    const result = await cleanupAbandonedSendFile(database as never, {
      id: 'file-1',
      sendId: 'send-1',
      ownerUserId: 'user-1',
      objectGeneration: 1,
      objectKey: 'sends/send-1/files/file-1/g1/aa',
      now: '2026-09-02T08:00:00.000Z',
    })

    expect(result).toEqual({ status: 'unchanged' })
    expect(database.calls[0]?.query).toContain(
      "lifecycle_state = 'pending_upload'",
    )
    expect(database.calls[0]?.query).toContain('object_generation = ?')
    expect(database.calls[0]?.bindings).toEqual([
      '2026-09-02T08:00:00.000Z',
      'file-1',
      'send-1',
      'user-1',
      1,
      'sends/send-1/files/file-1/g1/aa',
    ])
  })

  it('issues a download ticket bound to both generations without storing URL material', async () => {
    const ticket = {
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
    const database = new RecordingDatabase(ticket)
    const result = await createSendDownloadTicket(database as never, ticket)

    expect(result).toEqual({ status: 'created', ticket })
    expect(database.calls[0]?.query).toContain(
      'INSERT INTO send_download_tickets',
    )
    expect(database.calls[0]?.query).not.toMatch(/ticket_url|object_key/iu)
    expect(database.calls[0]?.bindings).toEqual([
      'ab'.repeat(32),
      'send-1',
      'file-1',
      2,
      1,
      '2026-09-02T06:41:00.000Z',
      3,
      4096,
    ])
  })

  it('consumes only an unexpired ticket with remaining request and byte budget', async () => {
    const consumed = {
      ticketVerifier: 'ab'.repeat(32),
      sendId: 'send-1',
      fileId: 'file-1',
      accessGeneration: 2,
      objectGeneration: 1,
      expiresAt: '2026-09-02T06:41:00.000Z',
      maxRequests: 3,
      remainingBytes: 2048,
      consumedRequests: 1,
    }
    const database = new RecordingDatabase(consumed)
    const result = await consumeSendDownloadTicket(database as never, {
      ticketVerifier: 'ab'.repeat(32),
      requestedBytes: 2048,
      now: '2026-09-02T06:40:30.000Z',
    })

    expect(result).toEqual({ status: 'consumed', ticket: consumed })
    expect(database.calls[0]?.query).toContain(
      'consumed_requests = consumed_requests + 1',
    )
    expect(database.calls[0]?.query).toContain(
      'consumed_requests < max_requests',
    )
    expect(database.calls[0]?.query).toContain('expires_at > ?')
    expect(database.calls[0]?.bindings).toEqual([
      2048,
      'ab'.repeat(32),
      2048,
      '2026-09-02T06:40:30.000Z',
    ])
  })

  it('does not consume an exhausted or generation-stale ticket', async () => {
    const database = new RecordingDatabase(null, 0)
    const result = await consumeSendDownloadTicket(database as never, {
      ticketVerifier: 'ab'.repeat(32),
      requestedBytes: 2048,
      now: '2026-09-02T06:41:01.000Z',
    })

    expect(result).toEqual({ status: 'unavailable' })
  })

  it('tombstones the matching file generation in D1 before object cleanup', async () => {
    const deleted = {
      ...pendingFile,
      lifecycleState: 'deleted',
      deletedAt: '2026-09-02T08:00:00.000Z',
    }
    const database = new RecordingDatabase(deleted)
    const result = await revokeSendFile(database as never, {
      id: 'file-1',
      sendId: 'send-1',
      ownerUserId: 'user-1',
      objectGeneration: 1,
      now: '2026-09-02T08:00:00.000Z',
    })

    expect(result).toEqual({ status: 'revoked', file: deleted })
    expect(database.calls[0]?.query).toContain("lifecycle_state = 'deleted'")
    expect(database.calls[0]?.query).toContain('object_generation = ?')
    expect(database.calls[0]?.query).toContain('deleted_at IS NULL')
    expect(database.calls[0]?.bindings).toEqual([
      '2026-09-02T08:00:00.000Z',
      'file-1',
      'send-1',
      'user-1',
      1,
    ])
  })

  it('previews file Send metadata without incrementing access_count', async () => {
    const preview = { id: 'send-1', accessCount: 2, type: 1 }
    const database = new RecordingDatabase(preview)
    const result = await previewFileSendAccess(database as never, {
      capabilityVerifier: 'ab'.repeat(32),
      accessGeneration: 2,
      now: '2026-09-02T06:40:30.000Z',
    })

    expect(result).toEqual({ status: 'ok', send: preview })
    expect(database.calls[0]?.query).toContain('SELECT')
    expect(database.calls[0]?.query).not.toContain(
      'access_count = access_count + 1',
    )
    expect(database.calls[0]?.query).toContain('type = 1')
  })

  it('consumes file Send access only when issuing a download, not on preview', async () => {
    const consumed = { id: 'send-1', accessCount: 3, type: 1 }
    const database = new RecordingDatabase(consumed)
    const result = await consumeFileSendAccess(database as never, {
      capabilityVerifier: 'ab'.repeat(32),
      accessGeneration: 2,
      now: '2026-09-02T06:40:30.000Z',
    })

    expect(result).toEqual({ status: 'consumed', send: consumed })
    expect(database.calls[0]?.query).toContain(
      'access_count = access_count + 1',
    )
    expect(database.calls[0]?.query).toContain('type = 1')
    expect(database.calls[0]?.query).toContain(
      'access_count < max_access_count',
    )
  })
})
