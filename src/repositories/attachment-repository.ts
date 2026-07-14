import {
  attachmentStoragePolicy,
  pendingAttachmentExpiresAt,
} from '../domain/attachment'

export type CipherAttachmentUploadState = 'pending' | 'uploaded'

export type CipherAttachmentRecord = {
  id: string
  userId: string
  cipherId: string
  objectKey: string
  fileName: string
  attachmentKey: string
  size: number
  contentType: string | null
  uploadState: CipherAttachmentUploadState
  pendingExpiresAt: string | null
  revisionDate: string
  createdAt: string
  updatedAt: string
}

type CipherAttachmentStateIndependentFields = Omit<
  CipherAttachmentRecord,
  'contentType' | 'uploadState' | 'pendingExpiresAt'
>

export type CipherAttachmentCreateInput =
  CipherAttachmentStateIndependentFields & {
    contentType: string
    uploadState: 'uploaded'
    pendingExpiresAt: null
  }

export type PendingCipherAttachmentCreateInput =
  CipherAttachmentStateIndependentFields & {
    contentType: null
    uploadState: 'pending'
    pendingExpiresAt: string
  }

export type CipherAttachmentLookupInput = {
  id: string
  cipherId: string
  userId: string
}

export type CipherAttachmentObjectKey = {
  cipherId: string
  objectKey: string
}

export type CipherAttachmentDeleteResult =
  | {
      status: 'deleted'
    }
  | {
      status: 'not_found'
    }

export type CipherAttachmentUploadResult =
  | {
      status: 'uploaded'
    }
  | {
      status: 'not_found'
    }

export type CipherAttachmentUploadReservationResult =
  | {
      status: 'reserved'
    }
  | {
      status: 'unavailable'
    }

export type PendingCipherAttachmentCreateResult =
  | {
      status: 'created'
      attachment: CipherAttachmentRecord
    }
  | {
      status: 'quota_exceeded'
    }

type AttachmentDatabase = Pick<D1Database, 'prepare'>
type AttachmentBatchDatabase = Pick<D1Database, 'batch' | 'prepare'>

const attachmentCipherIdChunkSize = 90

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

type CipherAttachmentStorageRow = {
  storageBytes: number | null
}

type CipherAttachmentObjectKeyRow = {
  cipherId: string
  objectKey: string
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

export async function createPendingCipherAttachment(
  database: AttachmentDatabase,
  input: PendingCipherAttachmentCreateInput,
  options: {
    maxStorageBytes: number
    expiredBefore: string
  },
): Promise<PendingCipherAttachmentCreateResult> {
  const result = await database
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
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE ? + COALESCE((
          SELECT SUM(size)
          FROM cipher_attachments
          WHERE user_id = ?
            AND (
              content_type IS NOT NULL
              OR (
                content_type IS NULL
                AND updated_at > ?
              )
            )
        ), 0) <= ?
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
      input.size,
      input.userId,
      options.expiredBefore,
      options.maxStorageBytes,
    )
    .run()

  if (result.meta.changes !== 1) {
    return { status: 'quota_exceeded' }
  }

  return { status: 'created', attachment: input }
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
        WHERE user_id = ? AND content_type IS NOT NULL
        ORDER BY revision_date ASC, id ASC
      `,
    )
    .bind(userId)
    .all<CipherAttachmentRow>()

  return result.results.map(attachmentFromRow)
}

export async function listCipherAttachmentObjectKeysForOwnedCiphers(
  database: AttachmentBatchDatabase,
  input: {
    cipherIds: readonly string[]
    userId: string
  },
): Promise<CipherAttachmentObjectKey[]> {
  if (input.cipherIds.length === 0) {
    return []
  }

  const cipherIdChunks: string[][] = []
  for (
    let index = 0;
    index < input.cipherIds.length;
    index += attachmentCipherIdChunkSize
  ) {
    cipherIdChunks.push(
      input.cipherIds.slice(index, index + attachmentCipherIdChunkSize),
    )
  }

  const results = await database.batch<CipherAttachmentObjectKeyRow>(
    cipherIdChunks.map((cipherIds) =>
      database
        .prepare(
          `
            SELECT
              attachment.cipher_id as cipherId,
              attachment.object_key as objectKey
            FROM cipher_attachments attachment
            INNER JOIN ciphers cipher
              ON cipher.id = attachment.cipher_id
              AND cipher.user_id = attachment.user_id
            WHERE cipher.id IN (${cipherIds.map(() => '?').join(', ')})
              AND cipher.user_id = ?
              AND attachment.user_id = ?
            ORDER BY attachment.id ASC
          `,
        )
        .bind(...cipherIds, input.userId, input.userId),
    ),
  )

  return results.flatMap((result) => result.results)
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

export async function getCipherAttachmentStorageUsage(
  database: AttachmentDatabase,
  userId: string,
): Promise<number> {
  const row = await database
    .prepare(
      `
        SELECT COALESCE(SUM(size), 0) as storageBytes
        FROM cipher_attachments
        WHERE user_id = ? AND content_type IS NOT NULL
      `,
    )
    .bind(userId)
    .first<CipherAttachmentStorageRow>()

  return readStorageBytes(row?.storageBytes)
}

export async function getCipherAttachmentReservedStorage(
  database: AttachmentDatabase,
  userId: string,
  expiredBefore: string,
): Promise<number> {
  const row = await database
    .prepare(
      `
        SELECT COALESCE(SUM(size), 0) as storageBytes
        FROM cipher_attachments
        WHERE user_id = ?
          AND (
            content_type IS NOT NULL
            OR (
              content_type IS NULL
              AND updated_at > ?
            )
          )
      `,
    )
    .bind(userId, expiredBefore)
    .first<CipherAttachmentStorageRow>()

  return readStorageBytes(row?.storageBytes)
}

export async function markCipherAttachmentUploaded(
  database: AttachmentDatabase,
  input: CipherAttachmentLookupInput & {
    contentType: string
    revisionDate: string
    updatedAt: string
  },
): Promise<CipherAttachmentUploadResult> {
  const result = await database
    .prepare(
      `
        UPDATE cipher_attachments
        SET
          content_type = ?,
          revision_date = ?,
          updated_at = ?
        WHERE id = ?
          AND cipher_id = ?
          AND user_id = ?
          AND content_type IS NULL
      `,
    )
    .bind(
      input.contentType,
      input.revisionDate,
      input.updatedAt,
      input.id,
      input.cipherId,
      input.userId,
    )
    .run()

  return result.meta.changes === 1
    ? { status: 'uploaded' }
    : { status: 'not_found' }
}

export async function reserveCipherAttachmentUpload(
  database: AttachmentDatabase,
  input: CipherAttachmentLookupInput & {
    size: number
    expiredBefore: string
    maxStorageBytes: number
    updatedAt: string
  },
): Promise<CipherAttachmentUploadReservationResult> {
  const result = await database
    .prepare(
      `
        UPDATE cipher_attachments
        SET updated_at = ?
        WHERE id = ?
          AND cipher_id = ?
          AND user_id = ?
          AND content_type IS NULL
          AND updated_at > ?
          AND ? + COALESCE((
            SELECT SUM(size)
            FROM cipher_attachments
            WHERE user_id = ?
              AND id <> ?
              AND (
                content_type IS NOT NULL
                OR (
                  content_type IS NULL
                  AND updated_at > ?
                )
              )
          ), 0) <= ?
      `,
    )
    .bind(
      input.updatedAt,
      input.id,
      input.cipherId,
      input.userId,
      input.expiredBefore,
      input.size,
      input.userId,
      input.id,
      input.expiredBefore,
      input.maxStorageBytes,
    )
    .run()

  return result.meta.changes === 1
    ? { status: 'reserved' }
    : { status: 'unavailable' }
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

export async function deleteExpiredPendingCipherAttachments(
  database: AttachmentDatabase,
  input: {
    expiredBefore: string
    limit: number
  },
): Promise<number> {
  const result = await database
    .prepare(
      `
        DELETE FROM cipher_attachments
        WHERE id IN (
          SELECT id
          FROM cipher_attachments
          WHERE content_type IS NULL
            AND updated_at <= ?
          ORDER BY updated_at ASC, id ASC
          LIMIT ?
        )
      `,
    )
    .bind(input.expiredBefore, input.limit)
    .run()

  return result.meta.changes
}

function attachmentFromRow(row: CipherAttachmentRow): CipherAttachmentRecord {
  // Uploaded attachments always receive a normalized content type before they
  // become visible. A null content type is therefore the pending-state marker,
  // which lets the v2 state machine use the existing schema without rewriting
  // a frozen migration.
  const uploadState = row.contentType === null ? 'pending' : 'uploaded'

  return {
    id: row.id,
    userId: row.userId,
    cipherId: row.cipherId,
    objectKey: row.objectKey,
    fileName: row.fileName,
    attachmentKey: row.attachmentKey,
    size: row.size,
    contentType: row.contentType,
    uploadState,
    pendingExpiresAt:
      uploadState === 'pending'
        ? pendingAttachmentExpiresAt(
            row.updatedAt,
            attachmentStoragePolicy.pendingAllocationTtlSeconds,
          )
        : null,
    revisionDate: row.revisionDate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function readStorageBytes(value: number | null | undefined): number {
  const storageBytes = Number(value ?? 0)
  if (!Number.isSafeInteger(storageBytes) || storageBytes < 0) {
    throw new Error('Attachment storage usage is invalid.')
  }

  return storageBytes
}
