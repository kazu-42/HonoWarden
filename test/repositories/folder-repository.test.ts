import { describe, expect, it } from 'vitest'

import {
  createFolder,
  deleteFolder,
  findFolderById,
  folderBelongsToUser,
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

  it('finds one active folder for a user', async () => {
    const database = new RecordingFolderD1Database([
      {
        id: 'folder-id',
        userId: 'user-id',
        name: '2.encrypted-folder-name',
        revisionDate: '2026-07-06T00:00:00.000Z',
      },
    ])

    await expect(
      findFolderById(database, {
        id: 'folder-id',
        userId: 'user-id',
      }),
    ).resolves.toEqual({
      id: 'folder-id',
      userId: 'user-id',
      name: '2.encrypted-folder-name',
      revisionDate: '2026-07-06T00:00:00.000Z',
    })
    expect(database.boundValues).toContain('folder-id')
    expect(database.boundValues).toContain('user-id')
    expect(database.queries.join('\n')).toContain('deleted_at IS NULL')
    expect(database.queries.join('\n')).toContain('LIMIT 1')
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
        expectedRevisionDate: '2026-07-06T00:00:00.000Z',
        revisionDate: '2026-07-06T00:01:00.000Z',
      }),
    ).resolves.toEqual({
      status: 'updated',
      folder: {
        id: 'folder-id',
        userId: 'user-id',
        name: '2.updated-encrypted-folder-name',
        revisionDate: '2026-07-06T00:01:00.000Z',
      },
    })
    expect(database.boundValues).toContain('folder-id')
    expect(database.boundValues).toContain('user-id')
    expect(database.boundValues).toContain('2026-07-06T00:00:00.000Z')
    expect(database.queries.join('\n')).toContain('user_id = ?')
    expect(database.queries.join('\n')).toContain('deleted_at IS NULL')
    expect(database.queries.join('\n')).toContain('AND revision_date = ?')
  })

  it('returns not found when updating a missing or cross-user folder', async () => {
    const database = new RecordingFolderD1Database([], {
      updateChanges: 0,
    })

    await expect(
      updateFolder(database, {
        id: 'folder-id',
        userId: 'user-id',
        name: '2.updated-encrypted-folder-name',
        expectedRevisionDate: '2026-07-06T00:00:00.000Z',
        revisionDate: '2026-07-06T00:01:00.000Z',
      }),
    ).resolves.toEqual({ status: 'not_found' })
  })

  it('returns conflict when updating a stale active folder', async () => {
    const database = new RecordingFolderD1Database(
      [
        {
          revisionDate: '2026-07-06T00:00:30.000Z',
        },
      ],
      {
        updateChanges: 0,
      },
    )

    await expect(
      updateFolder(database, {
        id: 'folder-id',
        userId: 'user-id',
        name: '2.updated-encrypted-folder-name',
        expectedRevisionDate: '2026-07-06T00:00:00.000Z',
        revisionDate: '2026-07-06T00:01:00.000Z',
      }),
    ).resolves.toEqual({
      status: 'conflict',
      currentRevisionDate: '2026-07-06T00:00:30.000Z',
    })
    expect(database.queries.join('\n')).toContain('SELECT revision_date')
    expect(database.queries.join('\n')).toContain('FROM folders')
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

  it('checks whether an active folder belongs to the user', async () => {
    const database = new RecordingFolderD1Database([
      {
        id: 'folder-id',
      },
    ])

    await expect(
      folderBelongsToUser(database, {
        folderId: 'folder-id',
        userId: 'user-id',
      }),
    ).resolves.toBe(true)
    expect(database.boundValues).toContain('folder-id')
    expect(database.boundValues).toContain('user-id')
    expect(database.queries.join('\n')).toContain('deleted_at IS NULL')
  })

  it('returns false when the folder is missing, deleted, or cross-user', async () => {
    const database = new RecordingFolderD1Database([])

    await expect(
      folderBelongsToUser(database, {
        folderId: 'folder-id',
        userId: 'user-id',
      }),
    ).resolves.toBe(false)
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
