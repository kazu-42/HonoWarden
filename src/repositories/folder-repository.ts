export type FolderRecord = {
  id: string
  userId: string
  name: string
  revisionDate: string
}

export type FolderWriteInput = {
  id: string
  userId: string
  name: string
  revisionDate: string
}

export type FolderUpdateInput = FolderWriteInput & {
  expectedRevisionDate: string
}

export type FolderDeleteInput = {
  id: string
  userId: string
  revisionDate: string
}

export type FolderOwnershipInput = {
  folderId: string
  userId: string
}

export type FolderDeleteResult =
  | {
      status: 'deleted'
      id: string
      revisionDate: string
    }
  | {
      status: 'not_found'
    }

export type FolderUpdateResult =
  | {
      status: 'updated'
      folder: FolderRecord
    }
  | {
      status: 'not_found'
    }
  | {
      status: 'conflict'
      currentRevisionDate: string
    }

type FolderDatabase = Pick<D1Database, 'prepare'>

type FolderRow = {
  id: string
  userId: string
  name: string
  revisionDate: string
}

type FolderRevisionRow = {
  revisionDate: string
}

export async function listFoldersByUser(
  database: FolderDatabase,
  userId: string,
): Promise<FolderRecord[]> {
  const result = await database
    .prepare(
      `
        SELECT
          id,
          user_id as userId,
          encrypted_name as name,
          revision_date as revisionDate
        FROM folders
        WHERE user_id = ? AND deleted_at IS NULL
        ORDER BY revision_date ASC, id ASC
      `,
    )
    .bind(userId)
    .all<FolderRow>()

  return result.results.map(folderFromRow)
}

export async function findFolderById(
  database: FolderDatabase,
  input: Pick<FolderRecord, 'id' | 'userId'>,
): Promise<FolderRecord | null> {
  const row = await database
    .prepare(
      `
        SELECT
          id,
          user_id as userId,
          encrypted_name as name,
          revision_date as revisionDate
        FROM folders
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL
        LIMIT 1
      `,
    )
    .bind(input.id, input.userId)
    .first<FolderRow>()

  return row ? folderFromRow(row) : null
}

export async function createFolder(
  database: FolderDatabase,
  input: FolderWriteInput,
): Promise<FolderRecord> {
  await database
    .prepare(
      `
        INSERT INTO folders (
          id,
          user_id,
          encrypted_name,
          revision_date,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      input.id,
      input.userId,
      input.name,
      input.revisionDate,
      input.revisionDate,
      input.revisionDate,
    )
    .run()

  return input
}

export async function updateFolder(
  database: FolderDatabase,
  input: FolderUpdateInput,
): Promise<FolderUpdateResult> {
  const result = await database
    .prepare(
      `
        UPDATE folders
        SET
          encrypted_name = ?,
          revision_date = ?,
          updated_at = ?
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND revision_date = ?
      `,
    )
    .bind(
      input.name,
      input.revisionDate,
      input.revisionDate,
      input.id,
      input.userId,
      input.expectedRevisionDate,
    )
    .run()

  if (result.meta.changes !== 1) {
    const currentRevisionDate = await findActiveFolderRevision(database, {
      id: input.id,
      userId: input.userId,
    })

    if (!currentRevisionDate) {
      return {
        status: 'not_found',
      }
    }

    return {
      status: 'conflict',
      currentRevisionDate,
    }
  }

  return {
    status: 'updated',
    folder: folderFromUpdateInput(input),
  }
}

export async function deleteFolder(
  database: FolderDatabase,
  input: FolderDeleteInput,
): Promise<FolderDeleteResult> {
  const result = await database
    .prepare(
      `
        UPDATE folders
        SET
          deleted_at = ?,
          revision_date = ?,
          updated_at = ?
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL
      `,
    )
    .bind(
      input.revisionDate,
      input.revisionDate,
      input.revisionDate,
      input.id,
      input.userId,
    )
    .run()

  if (result.meta.changes !== 1) {
    return {
      status: 'not_found',
    }
  }

  return {
    status: 'deleted',
    id: input.id,
    revisionDate: input.revisionDate,
  }
}

export async function folderBelongsToUser(
  database: FolderDatabase,
  input: FolderOwnershipInput,
): Promise<boolean> {
  const row = await database
    .prepare(
      `
        SELECT id
        FROM folders
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL
        LIMIT 1
      `,
    )
    .bind(input.folderId, input.userId)
    .first<{ id: string }>()

  return row !== null
}

function folderFromRow(row: FolderRow): FolderRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    revisionDate: row.revisionDate,
  }
}

async function findActiveFolderRevision(
  database: FolderDatabase,
  input: Pick<FolderRecord, 'id' | 'userId'>,
): Promise<string | null> {
  const row = await database
    .prepare(
      `
        SELECT revision_date as revisionDate
        FROM folders
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL
        LIMIT 1
      `,
    )
    .bind(input.id, input.userId)
    .first<FolderRevisionRow>()

  return row?.revisionDate ?? null
}

function folderFromUpdateInput(input: FolderUpdateInput): FolderRecord {
  return {
    id: input.id,
    userId: input.userId,
    name: input.name,
    revisionDate: input.revisionDate,
  }
}
