export type CipherRecord = {
  id: string
  userId: string
  folderId: string | null
  type: number
  favorite: boolean
  encryptedJson: string
  revisionDate: string
  createdAt: string
}

export type CipherCreateInput = CipherRecord

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

type CipherRow = {
  id: string
  userId: string
  folderId: string | null
  type: number
  favorite: number | boolean
  encryptedJson: string
  revisionDate: string
  createdAt: string
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
          created_at as createdAt
        FROM ciphers
        WHERE user_id = ? AND deleted_at IS NULL
        ORDER BY revision_date ASC, id ASC
      `,
    )
    .bind(userId)
    .all<CipherRow>()

  return result.results.map(cipherFromRow)
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
  input: CipherCreateInput,
): Promise<CipherRecord | null> {
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
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL
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
    )
    .run()

  if (result.meta.changes !== 1) {
    return null
  }

  return input
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

function cipherFromRow(row: CipherRow): CipherRecord {
  return {
    id: row.id,
    userId: row.userId,
    folderId: row.folderId,
    type: row.type,
    favorite: Boolean(row.favorite),
    encryptedJson: row.encryptedJson,
    revisionDate: row.revisionDate,
    createdAt: row.createdAt,
  }
}
