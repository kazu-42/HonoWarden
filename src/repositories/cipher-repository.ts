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
