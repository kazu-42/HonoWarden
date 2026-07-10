export type AuthRequestStatus =
  'pending' | 'approved' | 'denied' | 'consumed' | 'expired'

export type AuthRequestRecord = {
  id: string
  userId: string | null
  requestType: 0 | 1
  requestDeviceIdentifier: string
  requestDeviceType: number
  requestPublicKey: string
  status: AuthRequestStatus
  requestApproved: boolean | null
  approvingDeviceIdentifier: string | null
  encryptedResponseKey: string | null
  createdAt: string
  responseAt: string | null
  consumedAt: string | null
  expiresAt: string
}

export type CreateAuthRequestInput = {
  id: string
  userId: string | null
  emailHash: string
  requestType: 0 | 1
  requestDeviceIdentifier: string
  requestDeviceType: number
  requestPublicKey: string
  accessCodeHash: string
  createdAt: string
  expiresAt: string
  retentionDeleteAfter: string
}

export type ApproveAuthRequestInput = {
  id: string
  userId: string
  approvingDeviceIdentifier: string
  encryptedResponseKey: string
  now: string
}

export type DenyAuthRequestInput = Omit<
  ApproveAuthRequestInput,
  'encryptedResponseKey'
>

export type ConsumeAuthRequestInput = {
  id: string
  accessCodeHash: string
  requestDeviceIdentifier: string
  now: string
}

export type AuthRequestTransitionResult =
  { status: 'updated' } | { status: 'not_updated' }

type AuthRequestDatabase = Pick<D1Database, 'prepare'>

type AuthRequestRow = Omit<AuthRequestRecord, 'requestApproved'> & {
  requestApproved: number | boolean | null
}

export async function createAuthRequest(
  database: AuthRequestDatabase,
  input: CreateAuthRequestInput,
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO auth_requests (
          id,
          user_id,
          email_hash,
          request_type,
          request_device_identifier,
          request_device_type,
          request_public_key,
          access_code_hash,
          status,
          created_at,
          expires_at,
          retention_delete_after,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
      `,
    )
    .bind(
      input.id,
      input.userId,
      input.emailHash,
      input.requestType,
      input.requestDeviceIdentifier,
      input.requestDeviceType,
      input.requestPublicKey,
      input.accessCodeHash,
      input.createdAt,
      input.expiresAt,
      input.retentionDeleteAfter,
      input.createdAt,
    )
    .run()
}

export async function listPendingAuthRequests(
  database: AuthRequestDatabase,
  userId: string,
  now: string,
): Promise<AuthRequestRecord[]> {
  const result = await database
    .prepare(
      `
        ${authRequestSelect}
        WHERE user_id = ?
          AND status = 'pending'
          AND expires_at > ?
        ORDER BY created_at DESC, id DESC
      `,
    )
    .bind(userId, now)
    .all<AuthRequestRow>()

  return result.results.map(mapAuthRequestRow)
}

export async function findAuthRequestForOwner(
  database: AuthRequestDatabase,
  id: string,
  userId: string,
): Promise<AuthRequestRecord | null> {
  const row = await database
    .prepare(
      `
        ${authRequestSelect}
        WHERE id = ? AND user_id = ?
        LIMIT 1
      `,
    )
    .bind(id, userId)
    .first<AuthRequestRow>()

  return row ? mapAuthRequestRow(row) : null
}

export async function findAuthRequestByAccessCodeHash(
  database: AuthRequestDatabase,
  id: string,
  accessCodeHash: string,
  now: string,
): Promise<AuthRequestRecord | null> {
  const row = await database
    .prepare(
      `
        ${authRequestSelect}
        WHERE id = ?
          AND access_code_hash = ?
          AND status IN ('pending', 'approved', 'denied')
          AND expires_at > ?
        LIMIT 1
      `,
    )
    .bind(id, accessCodeHash, now)
    .first<AuthRequestRow>()

  return row ? mapAuthRequestRow(row) : null
}

export async function approveAuthRequest(
  database: AuthRequestDatabase,
  input: ApproveAuthRequestInput,
): Promise<AuthRequestTransitionResult> {
  const result = await database
    .prepare(
      `
        UPDATE auth_requests
        SET
          status = 'approved',
          request_approved = 1,
          approving_device_identifier = ?,
          encrypted_response_key = ?,
          response_at = ?,
          updated_at = ?
        WHERE id = ?
          AND user_id = ?
          AND status = 'pending'
          AND expires_at > ?
          AND request_device_identifier <> ?
      `,
    )
    .bind(
      input.approvingDeviceIdentifier,
      input.encryptedResponseKey,
      input.now,
      input.now,
      input.id,
      input.userId,
      input.now,
      input.approvingDeviceIdentifier,
    )
    .run()

  return transitionResult(result.meta.changes)
}

export async function denyAuthRequest(
  database: AuthRequestDatabase,
  input: DenyAuthRequestInput,
): Promise<AuthRequestTransitionResult> {
  const result = await database
    .prepare(
      `
        UPDATE auth_requests
        SET
          status = 'denied',
          request_approved = 0,
          approving_device_identifier = ?,
          encrypted_response_key = NULL,
          response_at = ?,
          updated_at = ?
        WHERE id = ?
          AND user_id = ?
          AND status = 'pending'
          AND expires_at > ?
          AND request_device_identifier <> ?
      `,
    )
    .bind(
      input.approvingDeviceIdentifier,
      input.now,
      input.now,
      input.id,
      input.userId,
      input.now,
      input.approvingDeviceIdentifier,
    )
    .run()

  return transitionResult(result.meta.changes)
}

export async function consumeAuthRequest(
  database: AuthRequestDatabase,
  input: ConsumeAuthRequestInput,
): Promise<AuthRequestTransitionResult> {
  const result = await database
    .prepare(
      `
        UPDATE auth_requests
        SET
          status = 'consumed',
          consumed_at = ?,
          updated_at = ?
        WHERE id = ?
          AND access_code_hash = ?
          AND request_device_identifier = ?
          AND status = 'approved'
          AND expires_at > ?
      `,
    )
    .bind(
      input.now,
      input.now,
      input.id,
      input.accessCodeHash,
      input.requestDeviceIdentifier,
      input.now,
    )
    .run()

  return transitionResult(result.meta.changes)
}

export async function expireAuthRequests(
  database: AuthRequestDatabase,
  now: string,
  limit: number,
): Promise<number> {
  const result = await database
    .prepare(
      `
        UPDATE auth_requests
        SET status = 'expired', updated_at = ?
        WHERE id IN (
          SELECT id
          FROM auth_requests
          WHERE status IN ('pending', 'approved')
            AND expires_at <= ?
          ORDER BY expires_at ASC
          LIMIT ?
        )
      `,
    )
    .bind(now, now, limit)
    .run()

  return result.meta.changes
}

export async function deleteRetainedAuthRequests(
  database: AuthRequestDatabase,
  now: string,
  limit: number,
): Promise<number> {
  const result = await database
    .prepare(
      `
        DELETE FROM auth_requests
        WHERE id IN (
          SELECT id
          FROM auth_requests
          WHERE status IN ('denied', 'consumed', 'expired')
            AND retention_delete_after <= ?
          ORDER BY retention_delete_after ASC
          LIMIT ?
        )
      `,
    )
    .bind(now, limit)
    .run()

  return result.meta.changes
}

const authRequestSelect = `
  SELECT
    id,
    user_id as userId,
    request_type as requestType,
    request_device_identifier as requestDeviceIdentifier,
    request_device_type as requestDeviceType,
    request_public_key as requestPublicKey,
    status,
    request_approved as requestApproved,
    approving_device_identifier as approvingDeviceIdentifier,
    encrypted_response_key as encryptedResponseKey,
    created_at as createdAt,
    response_at as responseAt,
    consumed_at as consumedAt,
    expires_at as expiresAt
  FROM auth_requests
`

function mapAuthRequestRow(row: AuthRequestRow): AuthRequestRecord {
  return {
    ...row,
    requestApproved:
      row.requestApproved === null ? null : Boolean(row.requestApproved),
  }
}

function transitionResult(changes: number): AuthRequestTransitionResult {
  return changes === 1 ? { status: 'updated' } : { status: 'not_updated' }
}
