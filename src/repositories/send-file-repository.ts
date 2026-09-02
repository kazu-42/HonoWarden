export type SendFileLifecycleState = 'pending_upload' | 'active' | 'deleted'

export type SendFileRow = {
  id: string
  sendId: string
  ownerUserId: string
  objectGeneration: number
  objectKey: string
  expectedSize: number
  observedSize: number | null
  objectEtag: string | null
  lifecycleState: SendFileLifecycleState
  uploadDeadlineAt: string
  validatedAt: string | null
  cleanupLeaseUntil: string | null
  cleanupAttempts: number
  lastFailureClass: string | null
  deletedAt: string | null
}

export type CreatePendingSendFileInput = SendFileRow & {
  now: string
}

export type CompleteSendFileUploadInput = {
  id: string
  sendId: string
  ownerUserId: string
  objectGeneration: number
  objectKey: string
  observedSize: number
  objectEtag: string
  now: string
}

export type CleanupAbandonedSendFileInput = {
  id: string
  sendId: string
  ownerUserId: string
  objectGeneration: number
  objectKey: string
  now: string
}

export type SendDownloadTicketRow = {
  ticketVerifier: string
  sendId: string
  fileId: string
  accessGeneration: number
  objectGeneration: number
  expiresAt: string
  maxRequests: number
  remainingBytes: number
  consumedRequests: number
}

export type ConsumeSendDownloadTicketInput = {
  ticketVerifier: string
  requestedBytes: number
  now: string
}

export type RevokeSendFileInput = {
  id: string
  sendId: string
  ownerUserId: string
  objectGeneration: number
  now: string
}

type SendFileDatabase = Pick<D1Database, 'prepare'>

const sendFileProjection = `
  id,
  send_id AS sendId,
  owner_user_id AS ownerUserId,
  object_generation AS objectGeneration,
  object_key AS objectKey,
  expected_size AS expectedSize,
  observed_size AS observedSize,
  object_etag AS objectEtag,
  lifecycle_state AS lifecycleState,
  upload_deadline_at AS uploadDeadlineAt,
  validated_at AS validatedAt,
  cleanup_lease_until AS cleanupLeaseUntil,
  cleanup_attempts AS cleanupAttempts,
  last_failure_class AS lastFailureClass,
  deleted_at AS deletedAt
`

const sendDownloadTicketProjection = `
  ticket_verifier AS ticketVerifier,
  send_id AS sendId,
  file_id AS fileId,
  access_generation AS accessGeneration,
  object_generation AS objectGeneration,
  expires_at AS expiresAt,
  max_requests AS maxRequests,
  remaining_bytes AS remainingBytes,
  consumed_requests AS consumedRequests
`

export async function createPendingSendFile(
  database: SendFileDatabase,
  input: CreatePendingSendFileInput,
): Promise<{ status: 'created'; file: SendFileRow }> {
  const file = await database
    .prepare(
      `
        INSERT INTO send_files (
          id,
          send_id,
          owner_user_id,
          object_generation,
          object_key,
          expected_size,
          lifecycle_state,
          upload_deadline_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING ${sendFileProjection}
      `,
    )
    .bind(
      input.id,
      input.sendId,
      input.ownerUserId,
      input.objectGeneration,
      input.objectKey,
      input.expectedSize,
      input.lifecycleState,
      input.uploadDeadlineAt,
    )
    .first<SendFileRow>()

  if (!file) {
    throw new Error('File Send pending insert did not return a row.')
  }
  return { status: 'created', file }
}

export async function completeSendFileUpload(
  database: SendFileDatabase,
  input: CompleteSendFileUploadInput,
): Promise<
  { status: 'activated'; file: SendFileRow } | { status: 'unchanged' }
> {
  const file = await database
    .prepare(
      `
        UPDATE send_files
        SET
          observed_size = ?,
          object_etag = ?,
          validated_at = ?,
          lifecycle_state = 'active'
        WHERE id = ?
          AND send_id = ?
          AND owner_user_id = ?
          AND object_generation = ?
          AND object_key = ?
          AND expected_size = ?
          AND lifecycle_state = 'pending_upload'
          AND deleted_at IS NULL
        RETURNING ${sendFileProjection}
      `,
    )
    .bind(
      input.observedSize,
      input.objectEtag,
      input.now,
      input.id,
      input.sendId,
      input.ownerUserId,
      input.objectGeneration,
      input.objectKey,
      input.observedSize,
    )
    .first<SendFileRow>()

  return file ? { status: 'activated', file } : { status: 'unchanged' }
}

export async function cleanupAbandonedSendFile(
  database: SendFileDatabase,
  input: CleanupAbandonedSendFileInput,
): Promise<{ status: 'cleaned'; file: SendFileRow } | { status: 'unchanged' }> {
  const file = await database
    .prepare(
      `
        UPDATE send_files
        SET
          lifecycle_state = 'deleted',
          deleted_at = ?
        WHERE id = ?
          AND send_id = ?
          AND owner_user_id = ?
          AND object_generation = ?
          AND object_key = ?
          AND lifecycle_state = 'pending_upload'
          AND deleted_at IS NULL
        RETURNING ${sendFileProjection}
      `,
    )
    .bind(
      input.now,
      input.id,
      input.sendId,
      input.ownerUserId,
      input.objectGeneration,
      input.objectKey,
    )
    .first<SendFileRow>()

  return file ? { status: 'cleaned', file } : { status: 'unchanged' }
}

export async function createSendDownloadTicket(
  database: SendFileDatabase,
  input: SendDownloadTicketRow,
): Promise<{ status: 'created'; ticket: SendDownloadTicketRow }> {
  const ticket = await database
    .prepare(
      `
        INSERT INTO send_download_tickets (
          ticket_verifier,
          send_id,
          file_id,
          access_generation,
          object_generation,
          expires_at,
          max_requests,
          remaining_bytes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING ${sendDownloadTicketProjection}
      `,
    )
    .bind(
      input.ticketVerifier,
      input.sendId,
      input.fileId,
      input.accessGeneration,
      input.objectGeneration,
      input.expiresAt,
      input.maxRequests,
      input.remainingBytes,
    )
    .first<SendDownloadTicketRow>()

  if (!ticket) {
    throw new Error('File Send download-ticket insert did not return a row.')
  }
  return { status: 'created', ticket }
}

export async function consumeSendDownloadTicket(
  database: SendFileDatabase,
  input: ConsumeSendDownloadTicketInput,
): Promise<
  | { status: 'consumed'; ticket: SendDownloadTicketRow }
  | { status: 'unavailable' }
> {
  const ticket = await database
    .prepare(
      `
        UPDATE send_download_tickets
        SET
          remaining_bytes = remaining_bytes - ?,
          consumed_requests = consumed_requests + 1
        WHERE ticket_verifier = ?
          AND consumed_requests < max_requests
          AND remaining_bytes >= ?
          AND expires_at > ?
        RETURNING ${sendDownloadTicketProjection}
      `,
    )
    .bind(
      input.requestedBytes,
      input.ticketVerifier,
      input.requestedBytes,
      input.now,
    )
    .first<SendDownloadTicketRow>()

  return ticket ? { status: 'consumed', ticket } : { status: 'unavailable' }
}

export async function revokeSendFile(
  database: SendFileDatabase,
  input: RevokeSendFileInput,
): Promise<{ status: 'revoked'; file: SendFileRow } | { status: 'unchanged' }> {
  const file = await database
    .prepare(
      `
        UPDATE send_files
        SET
          lifecycle_state = 'deleted',
          deleted_at = ?
        WHERE id = ?
          AND send_id = ?
          AND owner_user_id = ?
          AND object_generation = ?
          AND lifecycle_state IN ('pending_upload', 'active')
          AND deleted_at IS NULL
        RETURNING ${sendFileProjection}
      `,
    )
    .bind(
      input.now,
      input.id,
      input.sendId,
      input.ownerUserId,
      input.objectGeneration,
    )
    .first<SendFileRow>()

  return file ? { status: 'revoked', file } : { status: 'unchanged' }
}
