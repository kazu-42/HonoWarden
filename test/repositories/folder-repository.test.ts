import { describe, expect, it } from 'vitest'

import {
  createFolder,
  deleteFolder,
  listFoldersByUser,
  updateFolder,
} from '../../src/repositories/folder-repository'

const fakeMeta = {
  duration: 0,
  size_after: 0,
  rows_read: 1,
  rows_written: 1,
  last_row_id: 1,
  changed_db: true,
  changes: 1,
} satisfies D1Meta & Record<string, unknown>

describe('folder repository', () => {
  it('lists active folders for one user', async () => {
    const database = new RecordingFolderD1Database([
      {
        id: 'folder-id',
        userId: 'user-id',
        name: '2.encrypted-folder-name',
        revisionDate: '2026-07-06T00:00:00.000Z',
      },
    ])

    await expect(listFoldersByUser(database, 'user-id')).resolves.toEqual([
      {
        id: 'folder-id',
        userId: 'user-id',
        name: '2.encrypted-folder-name',
        revisionDate: '2026-07-06T00:00:00.000Z',
      },
    ])
    expect(database.boundValues).toContain('user-id')
    expect(database.queries.join('\n')).toContain('deleted_at IS NULL')
  })

  it('creates a folder using the encrypted name as an opaque payload', async () => {
    const database = new RecordingFolderD1Database([])

    await expect(
      createFolder(database, {
        id: 'folder-id',
        userId: 'user-id',
        name: '2.encrypted-folder-name',
        revisionDate: '2026-07-06T00:00:00.000Z',
      }),
    ).resolves.toEqual({
      id: 'folder-id',
      userId: 'user-id',
      name: '2.encrypted-folder-name',
      revisionDate: '2026-07-06T00:00:00.000Z',
    })
    expect(database.boundValues).toContain('2.encrypted-folder-name')
    expect(database.boundValues).toContain('user-id')
  })

  it('updates a folder only when it belongs to the user and is active', async () => {
    const database = new RecordingFolderD1Database([], {
      updateChanges: 1,
    })

    await expect(
      updateFolder(database, {
        id: 'folder-id',
        userId: 'user-id',
        name: '2.updated-encrypted-folder-name',
        revisionDate: '2026-07-06T00:01:00.000Z',
      }),
    ).resolves.toEqual({
      id: 'folder-id',
      userId: 'user-id',
      name: '2.updated-encrypted-folder-name',
      revisionDate: '2026-07-06T00:01:00.000Z',
    })
    expect(database.boundValues).toContain('folder-id')
    expect(database.boundValues).toContain('user-id')
    expect(database.queries.join('\n')).toContain('user_id = ?')
    expect(database.queries.join('\n')).toContain('deleted_at IS NULL')
  })

  it('returns null when updating a missing or cross-user folder', async () => {
    const database = new RecordingFolderD1Database([], {
      updateChanges: 0,
    })

    await expect(
      updateFolder(database, {
        id: 'folder-id',
        userId: 'user-id',
        name: '2.updated-encrypted-folder-name',
        revisionDate: '2026-07-06T00:01:00.000Z',
      }),
    ).resolves.toBeNull()
  })

  it('soft-deletes a folder only when it belongs to the user and is active', async () => {
    const database = new RecordingFolderD1Database([], {
      deleteChanges: 1,
    })

    await expect(
      deleteFolder(database, {
        id: 'folder-id',
        userId: 'user-id',
        revisionDate: '2026-07-06T00:02:00.000Z',
      }),
    ).resolves.toEqual({
      status: 'deleted',
      id: 'folder-id',
      revisionDate: '2026-07-06T00:02:00.000Z',
    })
    expect(database.boundValues).toContain('folder-id')
    expect(database.boundValues).toContain('user-id')
    expect(database.queries.join('\n')).toContain('deleted_at = ?')
    expect(database.queries.join('\n')).toContain('deleted_at IS NULL')
  })

  it('returns not found when deleting a missing or cross-user folder', async () => {
    const database = new RecordingFolderD1Database([], {
      deleteChanges: 0,
    })

    await expect(
      deleteFolder(database, {
        id: 'folder-id',
        userId: 'user-id',
        revisionDate: '2026-07-06T00:02:00.000Z',
      }),
    ).resolves.toEqual({
      status: 'not_found',
    })
  })
})

class RecordingFolderD1Database {
  boundValues: unknown[] = []
  queries: string[] = []

  constructor(
    private readonly folderRows: unknown[],
    private readonly options: {
      deleteChanges?: number
      updateChanges?: number
    } = {},
  ) {}

  prepare(query: string): D1PreparedStatement {
    this.queries.push(query)
    const pushValues = (values: unknown[]) => {
      this.boundValues.push(...values)
    }
    const getRows = () => this.folderRows
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
        const changes = query.includes('deleted_at = ?')
          ? (getOptions().deleteChanges ?? 1)
          : (getOptions().updateChanges ?? 1)

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
