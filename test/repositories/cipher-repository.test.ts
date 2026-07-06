import { describe, expect, it } from 'vitest'

import {
  createCipher,
  listCiphersByUser,
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
})

class RecordingCipherD1Database {
  boundValues: unknown[] = []
  queries: string[] = []

  constructor(private readonly cipherRows: unknown[]) {}

  prepare(query: string): D1PreparedStatement {
    this.queries.push(query)
    const pushValues = (values: unknown[]) => {
      this.boundValues.push(...values)
    }
    const getRows = () => this.cipherRows

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
          meta: fakeMeta,
        }
      },
      async raw<T = unknown>(): Promise<T[]> {
        return []
      },
    } as D1PreparedStatement

    return statement
  }
}
