export type SendFileLifecycleState = 'pending_upload' | 'active' | 'deleted'

export type SendFileRow = {
  id: string
  sendId: string
  ownerUserId: string
  objectGeneration: number
  objectKey: string
  encryptedFileName: string
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

export type FileSendRow = {
  id: string
  ownerUserId: string
  type: 1
  authType: 1 | 2
  lifecycleState:
    | 'pending_upload'
    | 'active'
    | 'deleted'
    | 'disabled'
    | 'expired'
    | 'quarantined'
  capabilityEnvelope: string
  capabilityEnvelopeKeyId: string
  capabilityVerifier: string
  capabilityVerifierKeyId: string
  accessGeneration: number
  encryptedName: string
  encryptedNotes: string | null
  encryptedKey: string
  encryptedText: null
  textHidden: 0
  passwordVerifier: string | null
  passwordKeyId: string | null
  maxAccessCount: number | null
  accessCount: number
  disabled: number
  hideEmail: number
  expirationAt: string | null
  deletionAt: string
  revisionDate: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  quarantinedAt: string | null
  lastAccessedAt: string | null
}

export type CreatePendingFileSendInput = {
  send: FileSendRow
  file: SendFileRow
  auditEventId: string
  requestId: string
}

type SendFileDatabase = Pick<D1Database, 'prepare'>
type SendFileBatchDatabase = Pick<D1Database, 'batch' | 'prepare'>

const fileSendProjection = `
  id,
  owner_user_id AS ownerUserId,
  type,
  auth_type AS authType,
  lifecycle_state AS lifecycleState,
  capability_envelope AS capabilityEnvelope,
  capability_envelope_key_id AS capabilityEnvelopeKeyId,
  capability_verifier AS capabilityVerifier,
  capability_verifier_key_id AS capabilityVerifierKeyId,
  access_generation AS accessGeneration,
  encrypted_name AS encryptedName,
  encrypted_notes AS encryptedNotes,
  encrypted_key AS encryptedKey,
  encrypted_text AS encryptedText,
  text_hidden AS textHidden,
  password_verifier AS passwordVerifier,
  password_key_id AS passwordKeyId,
  max_access_count AS maxAccessCount,
  access_count AS accessCount,
  disabled,
  hide_email AS hideEmail,
  expiration_at AS expirationAt,
  deletion_at AS deletionAt,
  revision_date AS revisionDate,
  created_at AS createdAt,
  updated_at AS updatedAt,
  deleted_at AS deletedAt,
  quarantined_at AS quarantinedAt,
  last_accessed_at AS lastAccessedAt
`

const sendFileProjection = `
  id,
  send_id AS sendId,
  owner_user_id AS ownerUserId,
  object_generation AS objectGeneration,
  object_key AS objectKey,
  encrypted_file_name AS encryptedFileName,
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

export async function createPendingFileSend(
  database: SendFileBatchDatabase,
  input: CreatePendingFileSendInput,
): Promise<{ status: 'created'; send: FileSendRow; file: SendFileRow }> {
  const results = await database.batch([
    database
      .prepare(
        `
          INSERT INTO sends (
            id, owner_user_id, type, auth_type, lifecycle_state,
            capability_envelope, capability_envelope_key_id,
            capability_verifier, capability_verifier_key_id,
            access_generation, encrypted_name, encrypted_notes, encrypted_key,
            encrypted_text, text_hidden, password_verifier, password_key_id,
            max_access_count, access_count, disabled, hide_email,
            expiration_at, deletion_at, revision_date, created_at, updated_at,
            deleted_at, quarantined_at, last_accessed_at
          )
          VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?
          )
          RETURNING ${fileSendProjection}
        `,
      )
      .bind(
        input.send.id,
        input.send.ownerUserId,
        input.send.type,
        input.send.authType,
        input.send.lifecycleState,
        input.send.capabilityEnvelope,
        input.send.capabilityEnvelopeKeyId,
        input.send.capabilityVerifier,
        input.send.capabilityVerifierKeyId,
        input.send.accessGeneration,
        input.send.encryptedName,
        input.send.encryptedNotes,
        input.send.encryptedKey,
        input.send.encryptedText,
        input.send.textHidden,
        input.send.passwordVerifier,
        input.send.passwordKeyId,
        input.send.maxAccessCount,
        input.send.accessCount,
        input.send.disabled,
        input.send.hideEmail,
        input.send.expirationAt,
        input.send.deletionAt,
        input.send.revisionDate,
        input.send.createdAt,
        input.send.updatedAt,
        input.send.deletedAt,
        input.send.quarantinedAt,
        input.send.lastAccessedAt,
      ),
    database
      .prepare(
        `
          INSERT INTO send_files (
            id,
            send_id,
            owner_user_id,
            object_generation,
            object_key,
            encrypted_file_name,
            expected_size,
            lifecycle_state,
            upload_deadline_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING ${sendFileProjection}
        `,
      )
      .bind(
        input.file.id,
        input.file.sendId,
        input.file.ownerUserId,
        input.file.objectGeneration,
        input.file.objectKey,
        input.file.encryptedFileName,
        input.file.expectedSize,
        input.file.lifecycleState,
        input.file.uploadDeadlineAt,
      ),
    database
      .prepare(
        `
          INSERT INTO audit_events (
            id, schema_version, name, outcome, request_id, occurred_at,
            actor_user_id, actor_device_identifier, target_type, target_id,
            context_json
          )
          VALUES (?, 1, 'send.file.create', 'success', ?, ?, ?, NULL, 'send', ?, ?)
        `,
      )
      .bind(
        input.auditEventId,
        input.requestId,
        input.send.createdAt,
        input.send.ownerUserId,
        input.send.id,
        JSON.stringify({ type: 'file' }),
      ),
  ])

  const send = results[0]?.results[0] as FileSendRow | undefined
  const file = results[1]?.results[0] as SendFileRow | undefined
  if (
    results.length !== 3 ||
    results.some((result) => !result.success || result.meta.changes !== 1) ||
    !send ||
    !file
  ) {
    throw new Error('File Send pending create batch did not fully apply.')
  }
  return { status: 'created', send, file }
}

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
          encrypted_file_name,
          expected_size,
          lifecycle_state,
          upload_deadline_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING ${sendFileProjection}
      `,
    )
    .bind(
      input.id,
      input.sendId,
      input.ownerUserId,
      input.objectGeneration,
      input.objectKey,
      input.encryptedFileName,
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
