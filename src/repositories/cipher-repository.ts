export type CipherRecord = {
  id: string
  userId: string
  folderId: string | null
  type: number
  favorite: boolean
  encryptedJson: string
  revisionDate: string
  createdAt: string
  deletedAt?: string | null
}

export type CipherCreateInput = CipherRecord

export type CipherUpdateInput = CipherRecord & {
  expectedRevisionDate: string
}

export type CipherDeleteInput = {
  id: string
  userId: string
  deletedAt: string
}

export type CipherRestoreInput = {
  id: string
  userId: string
  revisionDate: string
}

export type CipherPermanentDeleteInput = {
  id: string
  userId: string
  revisionDate: string
}

export type CipherBulkMutationInput = {
  ids: readonly string[]
  userId: string
  revisionDate: string
}

export type CipherBulkMoveInput = CipherBulkMutationInput & {
  folderId: string | null
}

export type CipherListCursor = {
  revisionDate: string
  id: string
}

export type CipherListPageInput = {
  userId: string
  limit: number
  cursor: CipherListCursor | null
}

export type CipherListPage = {
  items: CipherRecord[]
  hasMore: boolean
}

export type CipherAccess = {
  found: boolean
  canRead: boolean
  canEdit: boolean
  canDelete: boolean
  organizationId: string | null
}

export type CipherSoftDeleteResult =
  | {
      status: 'deleted'
      id: string
      revisionDate: string
      deletedAt: string
    }
  | {
      status: 'not_found'
    }

export type CipherUpdateResult =
  | {
      status: 'updated'
      cipher: CipherRecord
    }
  | {
      status: 'not_found'
    }
  | {
      status: 'conflict'
      currentRevisionDate: string
    }

export type CipherRestoreResult =
  | {
      status: 'restored'
      id: string
      revisionDate: string
    }
  | {
      status: 'not_found'
    }

export type CipherPermanentDeleteResult =
  | {
      status: 'deleted'
      id: string
      revisionDate: string
    }
  | {
      status: 'not_found'
    }

type CipherDatabase = Pick<D1Database, 'prepare'>
type CipherBatchDatabase = Pick<D1Database, 'batch' | 'prepare'>

const cipherBulkMutationChunkSize = 90

type CipherRow = {
  id: string
  userId: string
  folderId: string | null
  type: number
  favorite: number | boolean
  encryptedJson: string
  revisionDate: string
  createdAt: string
  deletedAt?: string | null
}

type CipherRevisionRow = {
  revisionDate: string
}

type CipherAccessRow = {
  id: string
  userId: string
  organizationId: string | null
}

export async function listCiphersByUser(
  database: CipherDatabase,
  userId: string,
): Promise<CipherRecord[]> {
  const result = await database
    .prepare(
      `
        SELECT
          id,
          user_id as userId,
          folder_id as folderId,
          type,
          favorite,
          encrypted_json as encryptedJson,
          revision_date as revisionDate,
          created_at as createdAt,
          deleted_at as deletedAt
        FROM ciphers
        WHERE user_id = ?
          AND organization_id IS NULL
        ORDER BY revision_date ASC, id ASC
      `,
    )
    .bind(userId)
    .all<CipherRow>()

  return result.results.map(cipherFromRow)
}

export async function listCiphersByUserPage(
  database: CipherDatabase,
  input: CipherListPageInput,
): Promise<CipherListPage> {
  const cursorPredicate = input.cursor
    ? 'AND (revision_date > ? OR (revision_date = ? AND id > ?))'
    : ''
  const result = await database
    .prepare(
      `
        SELECT
          id,
          user_id as userId,
          folder_id as folderId,
          type,
          favorite,
          encrypted_json as encryptedJson,
          revision_date as revisionDate,
          created_at as createdAt,
          deleted_at as deletedAt
        FROM ciphers
        WHERE user_id = ?
          AND organization_id IS NULL
          ${cursorPredicate}
        ORDER BY revision_date ASC, id ASC
        LIMIT ?
      `,
    )
    .bind(
      input.userId,
      ...(input.cursor
        ? [
            input.cursor.revisionDate,
            input.cursor.revisionDate,
            input.cursor.id,
          ]
        : []),
      input.limit + 1,
    )
    .all<CipherRow>()
  const rows = result.results.map(cipherFromRow)

  return {
    items: rows.slice(0, input.limit),
    hasMore: rows.length > input.limit,
  }
}

export async function findCipherById(
  database: CipherDatabase,
  input: Pick<CipherRecord, 'id' | 'userId'>,
): Promise<CipherRecord | null> {
  const row = await database
    .prepare(
      `
        SELECT
          id,
          user_id as userId,
          folder_id as folderId,
          type,
          favorite,
          encrypted_json as encryptedJson,
          revision_date as revisionDate,
          created_at as createdAt,
          deleted_at as deletedAt
        FROM ciphers
        WHERE id = ? AND user_id = ?
        LIMIT 1
      `,
    )
    .bind(input.id, input.userId)
    .first<CipherRow>()

  return row ? cipherFromRow(row) : null
}

export async function resolveCipherAccess(
  database: CipherDatabase,
  callerUserId: string,
  cipherId: string,
): Promise<CipherAccess> {
  const cipher = await database
    .prepare(
      `
        SELECT
          id,
          user_id as userId,
          organization_id as organizationId
        FROM ciphers
        WHERE id = ?
        LIMIT 1
      `,
    )
    .bind(cipherId)
    .first<CipherAccessRow>()

  if (!cipher) {
    return deniedCipherAccess(false, null)
  }

  const organizationId = cipher.organizationId ?? null
  if (organizationId === null) {
    const isOwner = cipher.userId === callerUserId

    return {
      found: true,
      canRead: isOwner,
      canEdit: isOwner,
      canDelete: isOwner,
      organizationId: null,
    }
  }

  const managedCollection = await database
    .prepare(
      `
        SELECT 1 as hasManageAccess
        FROM organization_users membership
        INNER JOIN collection_users collection_user
          ON collection_user.organization_user_id = membership.id
          AND collection_user.manage = 1
        INNER JOIN collections collection
          ON collection.id = collection_user.collection_id
          AND collection.organization_id = membership.organization_id
        INNER JOIN collection_ciphers collection_cipher
          ON collection_cipher.collection_id = collection.id
        WHERE membership.user_id = ?
          AND membership.status = 2
          AND membership.organization_id = ?
          AND collection.organization_id = ?
          AND collection_cipher.cipher_id = ?
        LIMIT 1
      `,
    )
    .bind(callerUserId, organizationId, organizationId, cipherId)
    .first<{ hasManageAccess: number }>()
  const hasManageAccess = Boolean(managedCollection?.hasManageAccess)

  return {
    found: true,
    canRead: hasManageAccess,
    canEdit: hasManageAccess,
    canDelete: hasManageAccess,
    organizationId,
  }
}

function deniedCipherAccess(
  found: boolean,
  organizationId: string | null,
): CipherAccess {
  return {
    found,
    canRead: false,
    canEdit: false,
    canDelete: false,
    organizationId,
  }
}

export async function createCipher(
  database: CipherDatabase,
  input: CipherCreateInput,
): Promise<CipherRecord> {
  await database
    .prepare(
      `
        INSERT INTO ciphers (
          id,
          user_id,
          folder_id,
          type,
          favorite,
          encrypted_json,
          revision_date,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      input.id,
      input.userId,
      input.folderId,
      input.type,
      input.favorite ? 1 : 0,
      input.encryptedJson,
      input.revisionDate,
      input.createdAt,
      input.revisionDate,
    )
    .run()

  return input
}

export async function updateCipher(
  database: CipherDatabase,
  input: CipherUpdateInput,
): Promise<CipherUpdateResult> {
  const existingCreatedAt = await findActiveCipherCreatedAt(database, {
    id: input.id,
    userId: input.userId,
  })

  const result = await database
    .prepare(
      `
        UPDATE ciphers
        SET
          folder_id = ?,
          type = ?,
          favorite = ?,
          encrypted_json = ?,
          revision_date = ?,
          updated_at = ?
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND revision_date = ?
      `,
    )
    .bind(
      input.folderId,
      input.type,
      input.favorite ? 1 : 0,
      input.encryptedJson,
      input.revisionDate,
      input.revisionDate,
      input.id,
      input.userId,
      input.expectedRevisionDate,
    )
    .run()

  if (result.meta.changes !== 1) {
    const currentRevisionDate = await findActiveCipherRevision(database, {
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
    cipher: cipherFromUpdateInput({
      ...input,
      createdAt: existingCreatedAt ?? input.createdAt,
    }),
  }
}

export async function softDeleteCipher(
  database: CipherDatabase,
  input: CipherDeleteInput,
): Promise<CipherSoftDeleteResult> {
  const result = await database
    .prepare(
      `
        UPDATE ciphers
        SET
          deleted_at = ?,
          revision_date = ?,
          updated_at = ?
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL
      `,
    )
    .bind(
      input.deletedAt,
      input.deletedAt,
      input.deletedAt,
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
    revisionDate: input.deletedAt,
    deletedAt: input.deletedAt,
  }
}

export async function restoreCipher(
  database: CipherDatabase,
  input: CipherRestoreInput,
): Promise<CipherRestoreResult> {
  const result = await database
    .prepare(
      `
        UPDATE ciphers
        SET
          deleted_at = NULL,
          revision_date = ?,
          updated_at = ?
        WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL
      `,
    )
    .bind(input.revisionDate, input.revisionDate, input.id, input.userId)
    .run()

  if (result.meta.changes !== 1) {
    return {
      status: 'not_found',
    }
  }

  return {
    status: 'restored',
    id: input.id,
    revisionDate: input.revisionDate,
  }
}

export async function permanentlyDeleteCipher(
  database: CipherDatabase,
  input: CipherPermanentDeleteInput,
): Promise<CipherPermanentDeleteResult> {
  const result = await database
    .prepare(
      `
        DELETE FROM ciphers
        WHERE id = ? AND user_id = ?
      `,
    )
    .bind(input.id, input.userId)
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

export async function bulkMoveCiphers(
  database: CipherBatchDatabase,
  input: CipherBulkMoveInput,
): Promise<number> {
  const statements = chunkCipherIds(input.ids).map((ids) =>
    database
      .prepare(
        `
          UPDATE ciphers
          SET
            folder_id = ?,
            revision_date = ?,
            updated_at = ?
          WHERE id IN (${cipherIdPlaceholders(ids)})
            AND user_id = ?
            AND deleted_at IS NULL
        `,
      )
      .bind(
        input.folderId,
        input.revisionDate,
        input.revisionDate,
        ...ids,
        input.userId,
      ),
  )

  return runCipherMutationBatch(database, statements)
}

export async function bulkSoftDeleteCiphers(
  database: CipherBatchDatabase,
  input: CipherBulkMutationInput,
): Promise<number> {
  const statements = chunkCipherIds(input.ids).map((ids) =>
    database
      .prepare(
        `
          UPDATE ciphers
          SET
            deleted_at = ?,
            revision_date = ?,
            updated_at = ?
          WHERE id IN (${cipherIdPlaceholders(ids)})
            AND user_id = ?
            AND deleted_at IS NULL
        `,
      )
      .bind(
        input.revisionDate,
        input.revisionDate,
        input.revisionDate,
        ...ids,
        input.userId,
      ),
  )

  return runCipherMutationBatch(database, statements)
}

export async function bulkRestoreCiphers(
  database: CipherBatchDatabase,
  input: CipherBulkMutationInput,
): Promise<string[]> {
  if (input.ids.length === 0) {
    return []
  }

  const statements = chunkCipherIds(input.ids).flatMap((ids) => {
    const placeholders = cipherIdPlaceholders(ids)

    return [
      database
        .prepare(
          `
            SELECT id
            FROM ciphers
            WHERE id IN (${placeholders})
              AND user_id = ?
              AND deleted_at IS NOT NULL
          `,
        )
        .bind(...ids, input.userId),
      database
        .prepare(
          `
            UPDATE ciphers
            SET
              deleted_at = NULL,
              revision_date = ?,
              updated_at = ?
            WHERE id IN (${placeholders})
              AND user_id = ?
              AND deleted_at IS NOT NULL
          `,
        )
        .bind(input.revisionDate, input.revisionDate, ...ids, input.userId),
    ]
  })
  const results = await database.batch<{ id: string }>(statements)
  const restoredIds: string[] = []

  for (let index = 0; index < results.length; index += 2) {
    restoredIds.push(
      ...(results[index]?.results ?? []).map((row) => String(row.id)),
    )
  }

  return restoredIds
}

export async function bulkPermanentlyDeleteCiphers(
  database: CipherBatchDatabase,
  input: CipherBulkMutationInput,
): Promise<number> {
  const statements = chunkCipherIds(input.ids).map((ids) =>
    database
      .prepare(
        `
          DELETE FROM ciphers
          WHERE id IN (${cipherIdPlaceholders(ids)})
            AND user_id = ?
        `,
      )
      .bind(...ids, input.userId),
  )

  return runCipherMutationBatch(database, statements)
}

async function runCipherMutationBatch(
  database: CipherBatchDatabase,
  statements: D1PreparedStatement[],
): Promise<number> {
  if (statements.length === 0) {
    return 0
  }

  const results = await database.batch(statements)

  return results.reduce((total, result) => total + result.meta.changes, 0)
}

function chunkCipherIds(ids: readonly string[]): string[][] {
  const chunks: string[][] = []

  for (
    let index = 0;
    index < ids.length;
    index += cipherBulkMutationChunkSize
  ) {
    chunks.push(ids.slice(index, index + cipherBulkMutationChunkSize))
  }

  return chunks
}

function cipherIdPlaceholders(ids: readonly string[]): string {
  return ids.map(() => '?').join(', ')
}

function cipherFromRow(row: CipherRow): CipherRecord {
  const cipher: CipherRecord = {
    id: row.id,
    userId: row.userId,
    folderId: row.folderId,
    type: row.type,
    favorite: Boolean(row.favorite),
    encryptedJson: row.encryptedJson,
    revisionDate: row.revisionDate,
    createdAt: row.createdAt,
  }

  if (row.deletedAt != null) {
    cipher.deletedAt = row.deletedAt
  }

  return cipher
}

async function findActiveCipherRevision(
  database: CipherDatabase,
  input: Pick<CipherRecord, 'id' | 'userId'>,
): Promise<string | null> {
  const row = await database
    .prepare(
      `
        SELECT revision_date as revisionDate
        FROM ciphers
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL
        LIMIT 1
      `,
    )
    .bind(input.id, input.userId)
    .first<CipherRevisionRow>()

  return row?.revisionDate ?? null
}

async function findActiveCipherCreatedAt(
  database: CipherDatabase,
  input: Pick<CipherRecord, 'id' | 'userId'>,
): Promise<string | null> {
  const row = await database
    .prepare(
      `
        SELECT created_at as createdAt
        FROM ciphers
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL
        LIMIT 1
      `,
    )
    .bind(input.id, input.userId)
    .first<Pick<CipherRow, 'createdAt'>>()

  return row?.createdAt ?? null
}

function cipherFromUpdateInput(input: CipherUpdateInput): CipherRecord {
  return {
    id: input.id,
    userId: input.userId,
    folderId: input.folderId,
    type: input.type,
    favorite: input.favorite,
    encryptedJson: input.encryptedJson,
    revisionDate: input.revisionDate,
    createdAt: input.createdAt,
  }
}
