export type CipherAttachmentRecord = {
  id: string
  userId: string
  cipherId: string
  objectKey: string
  fileName: string
  attachmentKey: string
  size: number
  contentType: string | null
  revisionDate: string
  createdAt: string
  updatedAt: string
}

export type CipherAttachmentCreateInput = CipherAttachmentRecord

export type CipherAttachmentLookupInput = {
  id: string
  cipherId: string
  userId: string
}

export type CipherAttachmentDeleteResult =
  | {
      status: 'deleted'
    }
  | {
      status: 'not_found'
    }

type AttachmentDatabase = Pick<D1Database, 'prepare'>

type CipherAttachmentRow = {
  id: string
  userId: string
  cipherId: string
  objectKey: string
  fileName: string
  attachmentKey: string
  size: number
  contentType: string | null
  revisionDate: string
  createdAt: string
  updatedAt: string
}

export async function createCipherAttachment(
  database: AttachmentDatabase,
  input: CipherAttachmentCreateInput,
): Promise<CipherAttachmentRecord> {
  await database
    .prepare(
      `
        INSERT INTO cipher_attachments (
          id,
          user_id,
          cipher_id,
          object_key,
          file_name,
          attachment_key,
          size,
          content_type,
          revision_date,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      input.id,
      input.userId,
      input.cipherId,
      input.objectKey,
      input.fileName,
      input.attachmentKey,
      input.size,
      input.contentType,
      input.revisionDate,
      input.createdAt,
      input.updatedAt,
    )
    .run()

  return input
}

export async function listCipherAttachmentsByUser(
  database: AttachmentDatabase,
  userId: string,
): Promise<CipherAttachmentRecord[]> {
  const result = await database
    .prepare(
      `
        SELECT
          id,
          user_id as userId,
          cipher_id as cipherId,
          object_key as objectKey,
          file_name as fileName,
          attachment_key as attachmentKey,
          size,
          content_type as contentType,
          revision_date as revisionDate,
          created_at as createdAt,
          updated_at as updatedAt
        FROM cipher_attachments
        WHERE user_id = ?
        ORDER BY revision_date ASC, id ASC
      `,
    )
    .bind(userId)
    .all<CipherAttachmentRow>()

  return result.results.map(attachmentFromRow)
}

export async function findCipherAttachment(
  database: AttachmentDatabase,
  input: CipherAttachmentLookupInput,
): Promise<CipherAttachmentRecord | null> {
  const row = await database
    .prepare(
      `
        SELECT
          id,
          user_id as userId,
          cipher_id as cipherId,
          object_key as objectKey,
          file_name as fileName,
          attachment_key as attachmentKey,
          size,
          content_type as contentType,
          revision_date as revisionDate,
          created_at as createdAt,
          updated_at as updatedAt
        FROM cipher_attachments
        WHERE id = ? AND cipher_id = ? AND user_id = ?
        LIMIT 1
      `,
    )
    .bind(input.id, input.cipherId, input.userId)
    .first<CipherAttachmentRow>()

  return row ? attachmentFromRow(row) : null
}

export async function deleteCipherAttachment(
  database: AttachmentDatabase,
  input: CipherAttachmentLookupInput,
): Promise<CipherAttachmentDeleteResult> {
  const result = await database
    .prepare(
      `
        DELETE FROM cipher_attachments
        WHERE id = ? AND cipher_id = ? AND user_id = ?
      `,
    )
    .bind(input.id, input.cipherId, input.userId)
    .run()

  if (result.meta.changes !== 1) {
    return { status: 'not_found' }
  }

  return { status: 'deleted' }
}

function attachmentFromRow(row: CipherAttachmentRow): CipherAttachmentRecord {
  return {
    id: row.id,
    userId: row.userId,
    cipherId: row.cipherId,
    objectKey: row.objectKey,
    fileName: row.fileName,
    attachmentKey: row.attachmentKey,
    size: row.size,
    contentType: row.contentType,
    revisionDate: row.revisionDate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
