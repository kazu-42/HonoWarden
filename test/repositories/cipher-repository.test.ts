import { describe, expect, it } from 'vitest'

import {
  createCipher,
  permanentlyDeleteCipher,
  restoreCipher,
  softDeleteCipher,
  listCiphersByUser,
  updateCipher,
} from '../../src/repositories/cipher-repository'

const fakeMeta = {
  duration: 0,
  size_after: 0,
  rows_read: 1,
  rows_written: 1,
  last_row_id: 1,
  changed_db: true,
  changes: 1,
} satisfies D1Meta & Record<string, unknown>

describe('cipher repository', () => {
  it('lists active ciphers for one user', async () => {
    const database = new RecordingCipherD1Database([
      {
        id: 'cipher-id',
        userId: 'user-id',
        folderId: 'folder-id',
        type: 1,
        favorite: 1,
        encryptedJson: '{"name":"2.encrypted-name"}',
        revisionDate: '2026-07-06T00:04:00.000Z',
        createdAt: '2026-07-06T00:04:00.000Z',
      },
    ])

    await expect(listCiphersByUser(database, 'user-id')).resolves.toEqual([
      {
        id: 'cipher-id',
        userId: 'user-id',
        folderId: 'folder-id',
        type: 1,
        favorite: true,
        encryptedJson: '{"name":"2.encrypted-name"}',
        revisionDate: '2026-07-06T00:04:00.000Z',
        createdAt: '2026-07-06T00:04:00.000Z',
      },
    ])
    expect(database.boundValues).toContain('user-id')
    expect(database.queries.join('\n')).toContain('deleted_at IS NULL')
  })

  it('creates a cipher with encrypted JSON as an opaque payload', async () => {
    const database = new RecordingCipherD1Database([])

    await expect(
      createCipher(database, {
        id: 'cipher-id',
        userId: 'user-id',
        folderId: 'folder-id',
        type: 1,
        favorite: true,
        encryptedJson: '{"name":"2.encrypted-name"}',
        revisionDate: '2026-07-06T00:04:00.000Z',
        createdAt: '2026-07-06T00:04:00.000Z',
      }),
    ).resolves.toEqual({
      id: 'cipher-id',
      userId: 'user-id',
      folderId: 'folder-id',
      type: 1,
      favorite: true,
      encryptedJson: '{"name":"2.encrypted-name"}',
      revisionDate: '2026-07-06T00:04:00.000Z',
      createdAt: '2026-07-06T00:04:00.000Z',
    })
    expect(database.boundValues).toContain('{"name":"2.encrypted-name"}')
    expect(database.boundValues).toContain(1)
    expect(database.boundValues).toContain('folder-id')
    expect(database.boundValues).toContain('user-id')
  })

  it('updates an active cipher only when it belongs to the user', async () => {
    const database = new RecordingCipherD1Database([], {
      updateChanges: 1,
    })

    await expect(
      updateCipher(database, {
        id: 'cipher-id',
        userId: 'user-id',
        folderId: null,
        type: 1,
        favorite: false,
        encryptedJson: '{"name":"2.updated-encrypted-name"}',
        expectedRevisionDate: '2026-07-06T00:04:00.000Z',
        revisionDate: '2026-07-06T00:06:00.000Z',
        createdAt: '2026-07-06T00:04:00.000Z',
      }),
    ).resolves.toEqual({
      status: 'updated',
      cipher: {
        id: 'cipher-id',
        userId: 'user-id',
        folderId: null,
        type: 1,
        favorite: false,
        encryptedJson: '{"name":"2.updated-encrypted-name"}',
        revisionDate: '2026-07-06T00:06:00.000Z',
        createdAt: '2026-07-06T00:04:00.000Z',
      },
    })
    expect(database.boundValues).toContain('cipher-id')
    expect(database.boundValues).toContain('user-id')
    expect(database.boundValues).toContain('2026-07-06T00:04:00.000Z')
    expect(database.queries.join('\n')).toContain('deleted_at IS NULL')
    expect(database.queries.join('\n')).toContain('AND revision_date = ?')
  })

  it('returns not found when updating a missing, deleted, or cross-user cipher', async () => {
    const database = new RecordingCipherD1Database([], {
      updateChanges: 0,
    })

    await expect(
      updateCipher(database, {
        id: 'cipher-id',
        userId: 'user-id',
        folderId: null,
        type: 1,
        favorite: false,
        encryptedJson: '{"name":"2.updated-encrypted-name"}',
        expectedRevisionDate: '2026-07-06T00:04:00.000Z',
        revisionDate: '2026-07-06T00:06:00.000Z',
        createdAt: '2026-07-06T00:04:00.000Z',
      }),
    ).resolves.toEqual({ status: 'not_found' })
  })

  it('returns conflict when updating a stale active cipher', async () => {
    const database = new RecordingCipherD1Database(
      [
        {
          revisionDate: '2026-07-06T00:05:00.000Z',
        },
      ],
      {
        updateChanges: 0,
      },
    )

    await expect(
      updateCipher(database, {
        id: 'cipher-id',
        userId: 'user-id',
        folderId: null,
        type: 1,
        favorite: false,
        encryptedJson: '{"name":"2.updated-encrypted-name"}',
        expectedRevisionDate: '2026-07-06T00:04:00.000Z',
        revisionDate: '2026-07-06T00:06:00.000Z',
        createdAt: '2026-07-06T00:04:00.000Z',
      }),
    ).resolves.toEqual({
      status: 'conflict',
      currentRevisionDate: '2026-07-06T00:05:00.000Z',
    })
    expect(database.queries.join('\n')).toContain('SELECT revision_date')
    expect(database.queries.join('\n')).toContain('FROM ciphers')
  })

  it('soft-deletes an active cipher for one user', async () => {
    const database = new RecordingCipherD1Database([], {
      softDeleteChanges: 1,
    })

    await expect(
      softDeleteCipher(database, {
        id: 'cipher-id',
        userId: 'user-id',
        deletedAt: '2026-07-06T00:07:00.000Z',
      }),
    ).resolves.toEqual({
      status: 'deleted',
      id: 'cipher-id',
      revisionDate: '2026-07-06T00:07:00.000Z',
      deletedAt: '2026-07-06T00:07:00.000Z',
    })
    expect(database.boundValues).toContain('cipher-id')
    expect(database.boundValues).toContain('user-id')
    expect(database.queries.join('\n')).toContain('deleted_at = ?')
    expect(database.queries.join('\n')).toContain('deleted_at IS NULL')
  })

  it('restores a deleted cipher for one user', async () => {
    const database = new RecordingCipherD1Database([], {
      restoreChanges: 1,
    })

    await expect(
      restoreCipher(database, {
        id: 'cipher-id',
        userId: 'user-id',
        revisionDate: '2026-07-06T00:08:00.000Z',
      }),
    ).resolves.toEqual({
      status: 'restored',
      id: 'cipher-id',
      revisionDate: '2026-07-06T00:08:00.000Z',
    })
    expect(database.boundValues).toContain('cipher-id')
    expect(database.boundValues).toContain('user-id')
    expect(database.queries.join('\n')).toContain('deleted_at = NULL')
    expect(database.queries.join('\n')).toContain('deleted_at IS NOT NULL')
  })

  it('permanently deletes a cipher only when it belongs to the user', async () => {
    const database = new RecordingCipherD1Database([], {
      permanentDeleteChanges: 1,
    })

    await expect(
      permanentlyDeleteCipher(database, {
        id: 'cipher-id',
        userId: 'user-id',
        revisionDate: '2026-07-06T00:09:00.000Z',
      }),
    ).resolves.toEqual({
      status: 'deleted',
      id: 'cipher-id',
      revisionDate: '2026-07-06T00:09:00.000Z',
    })
    expect(database.boundValues).toContain('cipher-id')
    expect(database.boundValues).toContain('user-id')
    expect(database.queries.join('\n')).toContain('DELETE FROM ciphers')
    expect(database.queries.join('\n')).toContain('user_id = ?')
  })

  it('returns not found when lifecycle mutations affect no rows', async () => {
    const database = new RecordingCipherD1Database([], {
      permanentDeleteChanges: 0,
      restoreChanges: 0,
      softDeleteChanges: 0,
    })

    await expect(
      softDeleteCipher(database, {
        id: 'cipher-id',
        userId: 'user-id',
        deletedAt: '2026-07-06T00:07:00.000Z',
      }),
    ).resolves.toEqual({ status: 'not_found' })
    await expect(
      restoreCipher(database, {
        id: 'cipher-id',
        userId: 'user-id',
        revisionDate: '2026-07-06T00:08:00.000Z',
      }),
    ).resolves.toEqual({ status: 'not_found' })
    await expect(
      permanentlyDeleteCipher(database, {
        id: 'cipher-id',
        userId: 'user-id',
        revisionDate: '2026-07-06T00:09:00.000Z',
      }),
    ).resolves.toEqual({ status: 'not_found' })
  })
})

class RecordingCipherD1Database {
  boundValues: unknown[] = []
  queries: string[] = []

  constructor(
    private readonly cipherRows: unknown[],
    private readonly options: {
      permanentDeleteChanges?: number
      restoreChanges?: number
      softDeleteChanges?: number
      updateChanges?: number
    } = {},
  ) {}

  prepare(query: string): D1PreparedStatement {
    this.queries.push(query)
    const pushValues = (values: unknown[]) => {
      this.boundValues.push(...values)
    }
    const getRows = () => this.cipherRows
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
        let changes = 1

        if (/DELETE\s+FROM\s+ciphers/.test(query)) {
          changes = getOptions().permanentDeleteChanges ?? 1
        } else if (query.includes('deleted_at = NULL')) {
          changes = getOptions().restoreChanges ?? 1
        } else if (query.includes('deleted_at = ?')) {
          changes = getOptions().softDeleteChanges ?? 1
        } else if (/UPDATE\s+ciphers/.test(query)) {
          changes = getOptions().updateChanges ?? 1
        }

        return {
          success: true,
          results: [],
          meta: {
            ...fakeMeta,
            changes,
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
