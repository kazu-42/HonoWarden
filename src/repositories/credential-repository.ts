import type { AuditEvent } from '../domain/audit'

type CredentialRepositoryDatabase = Pick<D1Database, 'batch' | 'prepare'>

export type RotateAccountSecurityStampInput = {
  userId: string
  expectedMasterPasswordHash: string
  expectedSecurityStamp: string
  expectedRevisionDate: string
  nextSecurityStamp: string
  nextRevisionDate: string
  auditEventId: string
  auditEvent: AuditEvent
}

export type RotateAccountSecurityStampResult =
  | {
      status: 'rotated'
      securityStamp: string
      revisionDate: string
      revokedDeviceCount: number
      revokedRefreshTokenCount: number
      invalidatedAuthRequestCount: number
      auditEventId: string
    }
  | { status: 'conflict' }

export async function rotateAccountSecurityStamp(
  database: CredentialRepositoryDatabase,
  input: RotateAccountSecurityStampInput,
): Promise<RotateAccountSecurityStampResult> {
  const event = input.auditEvent
  const results = await database.batch([
    database
      .prepare(
        `
          UPDATE users
          SET
            security_stamp = ?,
            revision_date = ?,
            updated_at = ?
          WHERE id = ?
            AND disabled_at IS NULL
            AND master_password_hash = ?
            AND security_stamp = ?
            AND revision_date = ?
        `,
      )
      .bind(
        input.nextSecurityStamp,
        input.nextRevisionDate,
        input.nextRevisionDate,
        input.userId,
        input.expectedMasterPasswordHash,
        input.expectedSecurityStamp,
        input.expectedRevisionDate,
      ),
    database
      .prepare(
        `
          UPDATE devices
          SET revoked_at = ?, updated_at = ?
          WHERE user_id = ?
            AND revoked_at IS NULL
            AND EXISTS (
              SELECT 1
              FROM users
              WHERE id = ?
                AND security_stamp = ?
                AND revision_date = ?
            )
        `,
      )
      .bind(
        input.nextRevisionDate,
        input.nextRevisionDate,
        input.userId,
        input.userId,
        input.nextSecurityStamp,
        input.nextRevisionDate,
      ),
    database
      .prepare(
        `
          UPDATE refresh_tokens
          SET revoked_at = ?
          WHERE user_id = ?
            AND revoked_at IS NULL
            AND EXISTS (
              SELECT 1
              FROM users
              WHERE id = ?
                AND security_stamp = ?
                AND revision_date = ?
            )
        `,
      )
      .bind(
        input.nextRevisionDate,
        input.userId,
        input.userId,
        input.nextSecurityStamp,
        input.nextRevisionDate,
      ),
    database
      .prepare(
        `
          UPDATE auth_requests
          SET
            status = 'superseded',
            request_approved = 0,
            encrypted_response_key = NULL,
            updated_at = ?
          WHERE user_id = ?
            AND status IN ('pending', 'approved')
            AND EXISTS (
              SELECT 1
              FROM users
              WHERE id = ?
                AND security_stamp = ?
                AND revision_date = ?
            )
        `,
      )
      .bind(
        input.nextRevisionDate,
        input.userId,
        input.userId,
        input.nextSecurityStamp,
        input.nextRevisionDate,
      ),
    database
      .prepare(
        `
          INSERT INTO audit_events (
            id,
            schema_version,
            name,
            outcome,
            request_id,
            occurred_at,
            actor_user_id,
            actor_device_identifier,
            target_type,
            target_id,
            context_json
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          FROM users
          WHERE id = ?
            AND disabled_at IS NULL
            AND security_stamp = ?
            AND revision_date = ?
        `,
      )
      .bind(
        input.auditEventId,
        event.schemaVersion,
        event.name,
        event.outcome,
        event.requestId,
        event.occurredAt,
        event.actor?.userId ?? null,
        event.actor?.deviceIdentifier ?? null,
        event.target?.type ?? null,
        event.target?.id ?? null,
        event.context ? JSON.stringify(event.context) : null,
        input.userId,
        input.nextSecurityStamp,
        input.nextRevisionDate,
      ),
  ])

  if (results.length !== 5) {
    throw new Error(
      'credential rotation batch returned an invalid result count',
    )
  }

  const [
    userResult,
    deviceResult,
    refreshResult,
    authRequestResult,
    auditResult,
  ] = results
  const userChanges = userResult?.meta.changes ?? 0
  const deviceChanges = deviceResult?.meta.changes ?? 0
  const refreshChanges = refreshResult?.meta.changes ?? 0
  const authRequestChanges = authRequestResult?.meta.changes ?? 0
  const auditChanges = auditResult?.meta.changes ?? 0

  if (userChanges === 0) {
    if (
      deviceChanges !== 0 ||
      refreshChanges !== 0 ||
      authRequestChanges !== 0 ||
      auditChanges !== 0
    ) {
      throw new Error('credential rotation guard invariant was violated')
    }
    return { status: 'conflict' }
  }
  if (userChanges !== 1 || auditChanges !== 1) {
    throw new Error('credential rotation batch did not commit one generation')
  }

  return {
    status: 'rotated',
    securityStamp: input.nextSecurityStamp,
    revisionDate: input.nextRevisionDate,
    revokedDeviceCount: deviceChanges,
    revokedRefreshTokenCount: refreshChanges,
    invalidatedAuthRequestCount: authRequestChanges,
    auditEventId: input.auditEventId,
  }
}
