import { describe, expect, it } from 'vitest'

import {
  createCipherAttachment,
  createPendingCipherAttachment,
  deleteCipherAttachment,
  deleteExpiredPendingCipherAttachments,
  findCipherAttachment,
  getCipherAttachmentReservedStorage,
  getCipherAttachmentStorageUsage,
  listCipherAttachmentsByUser,
  markCipherAttachmentUploaded,
  reserveCipherAttachmentUpload,
} from '../../src/repositories/attachment-repository'

const fakeMeta = {
  duration: 0,
  size_after: 0,
  rows_read: 1,
  rows_written: 1,
  last_row_id: 1,
  changed_db: true,
  changes: 1,
} satisfies D1Meta & Record<string, unknown>

const attachmentRow = {
  id: 'attachment-id',
  userId: 'user-id',
  cipherId: 'cipher-id',
  objectKey: 'attachments/opaque-object-id',
  fileName: '2.encrypted-file-name',
  attachmentKey: '2.encrypted-attachment-key',
  size: 12,
  contentType: 'application/octet-stream',
  uploadState: 'uploaded' as const,
  pendingExpiresAt: null,
  revisionDate: '2026-07-10T00:00:00.000Z',
  createdAt: '2026-07-10T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:00.000Z',
}

describe('attachment repository', () => {
  it('creates owner-scoped metadata for an opaque R2 object key', async () => {
    const database = new RecordingAttachmentD1Database([])

    await expect(
      createCipherAttachment(database, attachmentRow),
    ).resolves.toEqual(attachmentRow)
    expect(database.boundValues).toEqual([
      'attachment-id',
      'user-id',
      'cipher-id',
      'attachments/opaque-object-id',
      '2.encrypted-file-name',
      '2.encrypted-attachment-key',
      12,
      'application/octet-stream',
      '2026-07-10T00:00:00.000Z',
      '2026-07-10T00:00:00.000Z',
      '2026-07-10T00:00:00.000Z',
    ])
    expect(database.queries.join('\n')).toContain(
      'INSERT INTO cipher_attachments',
    )
    expect(database.queries.join('\n')).not.toContain('email')
  })

  it('lists attachments for one owner and maps rows to response records', async () => {
    const database = new RecordingAttachmentD1Database([attachmentRow])

    await expect(
      listCipherAttachmentsByUser(database, 'user-id'),
    ).resolves.toEqual([attachmentRow])
    expect(database.boundValues).toEqual(['user-id'])
    expect(database.queries.join('\n')).toContain('WHERE user_id = ?')
    expect(database.queries.join('\n')).toContain(
      'ORDER BY revision_date ASC, id ASC',
    )
    expect(database.queries.join('\n')).toContain('content_type IS NOT NULL')
  })

  it('atomically creates pending metadata only while reserved storage fits', async () => {
    const database = new RecordingAttachmentD1Database([])
    const pending = {
      ...attachmentRow,
      contentType: null,
      uploadState: 'pending' as const,
      pendingExpiresAt: '2026-07-11T00:00:00.000Z',
    }

    await expect(
      createPendingCipherAttachment(database, pending, {
        maxStorageBytes: 1024,
        expiredBefore: '2026-07-09T00:00:00.000Z',
      }),
    ).resolves.toEqual({ status: 'created', attachment: pending })
    const query = database.queries.join('\n')
    expect(query).toContain('INSERT INTO cipher_attachments')
    expect(query).toContain('content_type IS NOT NULL')
    expect(query).toContain('content_type IS NULL')
    expect(query).toContain('updated_at > ?')
    expect(query).toContain('COALESCE((')
    expect(query).toContain('SELECT SUM(size)')
  })

  it('reports quota exhaustion when a pending insert changes no rows', async () => {
    const database = new RecordingAttachmentD1Database([], {
      insertChanges: 0,
    })

    await expect(
      createPendingCipherAttachment(
        database,
        {
          ...attachmentRow,
          contentType: null,
          uploadState: 'pending',
          pendingExpiresAt: '2026-07-11T00:00:00.000Z',
        },
        {
          maxStorageBytes: 1024,
          expiredBefore: '2026-07-09T00:00:00.000Z',
        },
      ),
    ).resolves.toEqual({ status: 'quota_exceeded' })
  })

  it('reads uploaded usage separately from active quota reservations', async () => {
    const database = new RecordingAttachmentD1Database([{ storageBytes: 12 }])

    await expect(
      getCipherAttachmentStorageUsage(database, 'user-id'),
    ).resolves.toBe(12)
    await expect(
      getCipherAttachmentReservedStorage(
        database,
        'user-id',
        '2026-07-10T00:00:00.000Z',
      ),
    ).resolves.toBe(12)
    const query = database.queries.join('\n')
    expect(query).toContain('content_type IS NOT NULL')
    expect(query).toContain('updated_at > ?')
  })

  it('marks a pending attachment uploaded with the full owner predicate', async () => {
    const database = new RecordingAttachmentD1Database([])

    await expect(
      markCipherAttachmentUploaded(database, {
        id: 'attachment-id',
        cipherId: 'cipher-id',
        userId: 'user-id',
        contentType: 'application/octet-stream',
        revisionDate: '2026-07-10T00:01:00.000Z',
        updatedAt: '2026-07-10T00:01:00.000Z',
      }),
    ).resolves.toEqual({ status: 'uploaded' })
    const query = database.queries.join('\n')
    expect(query).toContain('UPDATE cipher_attachments')
    expect(query).toContain('content_type IS NULL')
    expect(query).toContain('id = ?')
    expect(query).toContain('cipher_id = ?')
    expect(query).toContain('user_id = ?')
  })

  it('atomically renews a pending upload reservation with quota and owner predicates', async () => {
    const database = new RecordingAttachmentD1Database([])

    await expect(
      reserveCipherAttachmentUpload(database, {
        id: 'attachment-id',
        cipherId: 'cipher-id',
        userId: 'user-id',
        size: 12,
        expiredBefore: '2026-07-09T00:00:00.000Z',
        maxStorageBytes: 1024,
        updatedAt: '2026-07-10T00:01:00.000Z',
      }),
    ).resolves.toEqual({ status: 'reserved' })
    const query = database.queries.join('\n')
    expect(query).toContain('SET updated_at = ?')
    expect(query).toContain('content_type IS NULL')
    expect(query).toContain('updated_at > ?')
    expect(query).toContain('SELECT SUM(size)')
    expect(query).toContain('id <> ?')
    expect(query).toContain('id = ?')
    expect(query).toContain('cipher_id = ?')
    expect(query).toContain('user_id = ?')
  })

  it('deletes expired pending allocations in bounded slices', async () => {
    const database = new RecordingAttachmentD1Database([], {
      deleteChanges: 3,
    })

    await expect(
      deleteExpiredPendingCipherAttachments(database, {
        expiredBefore: '2026-07-11T00:00:00.000Z',
        limit: 100,
      }),
    ).resolves.toBe(3)
    const query = database.queries.join('\n')
    expect(query).toContain('content_type IS NULL')
    expect(query).toContain('updated_at <= ?')
    expect(query).toContain('ORDER BY updated_at ASC, id ASC')
    expect(query).toContain('LIMIT ?')
  })

  it('finds one attachment only when user, cipher, and attachment all match', async () => {
    const database = new RecordingAttachmentD1Database([attachmentRow])

    await expect(
      findCipherAttachment(database, {
        id: 'attachment-id',
        cipherId: 'cipher-id',
        userId: 'user-id',
      }),
    ).resolves.toEqual(attachmentRow)
    expect(database.boundValues).toEqual([
      'attachment-id',
      'cipher-id',
      'user-id',
    ])
    expect(database.queries.join('\n')).toContain('id = ?')
    expect(database.queries.join('\n')).toContain('cipher_id = ?')
    expect(database.queries.join('\n')).toContain('user_id = ?')
  })

  it('derives pending state and expiry from the null content-type reservation lease', async () => {
    const database = new RecordingAttachmentD1Database([
      {
        ...attachmentRow,
        contentType: null,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-10T00:00:00.000Z',
      },
    ])

    await expect(
      findCipherAttachment(database, {
        id: 'attachment-id',
        cipherId: 'cipher-id',
        userId: 'user-id',
      }),
    ).resolves.toMatchObject({
      uploadState: 'pending',
      pendingExpiresAt: '2026-07-11T00:00:00.000Z',
    })
  })

  it('deletes attachment metadata with owner and cipher predicates', async () => {
    const database = new RecordingAttachmentD1Database([], { deleteChanges: 1 })

    await expect(
      deleteCipherAttachment(database, {
        id: 'attachment-id',
        cipherId: 'cipher-id',
        userId: 'user-id',
      }),
    ).resolves.toEqual({ status: 'deleted' })
    expect(database.boundValues).toEqual([
      'attachment-id',
      'cipher-id',
      'user-id',
    ])
    expect(database.queries.join('\n')).toContain(
      'DELETE FROM cipher_attachments',
    )
    expect(database.queries.join('\n')).toContain('cipher_id = ?')
    expect(database.queries.join('\n')).toContain('user_id = ?')
  })

  it('returns not found when no scoped attachment row is deleted', async () => {
    const database = new RecordingAttachmentD1Database([], { deleteChanges: 0 })

    await expect(
      deleteCipherAttachment(database, {
        id: 'attachment-id',
        cipherId: 'cipher-id',
        userId: 'user-id',
      }),
    ).resolves.toEqual({ status: 'not_found' })
  })
})

class RecordingAttachmentD1Database {
  boundValues: unknown[] = []
  queries: string[] = []

  constructor(
    private readonly rows: unknown[],
    private readonly options: {
      deleteChanges?: number
      insertChanges?: number
      updateChanges?: number
    } = {},
  ) {}

  prepare(query: string): D1PreparedStatement {
    this.queries.push(query)
    const pushValues = (values: unknown[]) => {
      this.boundValues.push(...values)
    }
    const getRows = () => this.rows
    const getOptions = () => this.options

    const statement = {
      bind(...values: unknown[]) {
        pushValues(values)
        return statement
      },
      async first<T = unknown>(): Promise<T | null> {
        return (getRows()[0] ?? null) as T | null
      },
      async all<T = unknown>(): Promise<D1Result<T>> {
        return {
          success: true,
          results: getRows() as T[],
          meta: fakeMeta,
        }
      },
      async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        return {
          success: true,
          results: [],
          meta: {
            ...fakeMeta,
            changes: query.includes('DELETE FROM cipher_attachments')
              ? (getOptions().deleteChanges ?? 1)
              : query.includes('INSERT INTO cipher_attachments')
                ? (getOptions().insertChanges ?? 1)
                : query.includes('UPDATE cipher_attachments')
                  ? (getOptions().updateChanges ?? 1)
                  : 1,
          },
        }
      },
      async raw<T = unknown>(): Promise<T[]> {
        return []
      },
    } as D1PreparedStatement

    return statement
  }
}
