import type { AuditEvent } from '../domain/audit'
import type {
  EmergencyAccessStatus,
  EmergencyAccessType,
} from '../domain/emergency-access'

export type EmergencyAccessRow = {
  id: string
  grantorUserId: string
  granteeUserId: string | null
  emailNormalized: string | null
  type: EmergencyAccessType
  status: EmergencyAccessStatus
  waitTimeDays: number
  createdAt: string
  revisionDate: string
  updatedAt: string
  keyGeneration: number | null
}

export type InsertInvitedEmergencyAccessInput = {
  id: string
  grantorUserId: string
  emailNormalized: string
  type: EmergencyAccessType
  waitTimeDays: number
  inviteTokenHash: string
  inviteExpiresAt: string
  createdAt: string
}

export type AcceptInvitedEmergencyAccessInput = {
  id: string
  granteeUserId: string
  emailNormalized: string
  inviteTokenHash: string
  now: string
}

export type ConfirmAcceptedEmergencyAccessInput = {
  id: string
  grantorUserId: string
  keyEncrypted: string
  keyGeneration: number
  now: string
}

export type ReinviteEmergencyAccessInput = {
  id: string
  grantorUserId: string
  inviteTokenHash: string
  inviteExpiresAt: string
  now: string
}

export type UpdateEmergencyAccessInput = {
  id: string
  grantorUserId: string
  type: EmergencyAccessType
  waitTimeDays: number
  keyEncrypted: string | null
  now: string
}

export type DeleteEmergencyAccessInput = {
  id: string
  actorUserId: string
  role: 'grantor' | 'grantee'
}

type EmergencyAccessReadDatabase = Pick<D1Database, 'prepare'>
type EmergencyAccessMutationDatabase = Pick<D1Database, 'batch' | 'prepare'>

const contactProjection = `
  id,
  grantor_user_id AS grantorUserId,
  grantee_user_id AS granteeUserId,
  email_normalized AS emailNormalized,
  type,
  status,
  wait_time_days AS waitTimeDays,
  created_at AS createdAt,
  revision_date AS revisionDate,
  updated_at AS updatedAt,
  key_generation AS keyGeneration
`

export async function insertInvitedEmergencyAccess(
  database: EmergencyAccessMutationDatabase,
  input: InsertInvitedEmergencyAccessInput,
  successAuditEvent?: AuditEvent,
): Promise<
  { status: 'created'; contact: EmergencyAccessRow } | { status: 'conflict' }
> {
  const mutation = database
    .prepare(
      `
        INSERT INTO emergency_access (
          id, grantor_user_id, grantee_user_id, email_normalized, type, status,
          wait_time_days, invite_token_hash, invite_expires_at, key_encrypted,
          key_generation, recovery_initiated_at, last_notification_at,
          created_at, revision_date, updated_at
        )
        SELECT
          ?, ?, NULL, ?, ?, 0,
          ?, ?, ?, NULL,
          NULL, NULL, NULL,
          ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1
          FROM emergency_access existing
          WHERE existing.grantor_user_id = ?
            AND (
              existing.email_normalized = ?
              OR existing.grantee_user_id IN (
                SELECT id FROM users WHERE email_normalized = ?
              )
            )
        )
        RETURNING ${contactProjection}
      `,
    )
    .bind(
      input.id,
      input.grantorUserId,
      input.emailNormalized,
      input.type,
      input.waitTimeDays,
      input.inviteTokenHash,
      input.inviteExpiresAt,
      input.createdAt,
      input.createdAt,
      input.createdAt,
      input.grantorUserId,
      input.emailNormalized,
      input.emailNormalized,
    )

  try {
    const result = successAuditEvent
      ? await runAuditedEmergencyAccessMutation(
          database,
          mutation,
          successAuditEvent,
        )
      : await mutation.all<EmergencyAccessRow>()
    const contact = result.results[0]
    if (!contact || result.meta.changes !== 1) {
      return { status: 'conflict' }
    }

    return { status: 'created', contact }
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { status: 'conflict' }
    }

    throw error
  }
}

export async function acceptInvitedEmergencyAccess(
  database: EmergencyAccessMutationDatabase,
  input: AcceptInvitedEmergencyAccessInput,
  successAuditEvent?: AuditEvent,
): Promise<
  { status: 'accepted'; contact: EmergencyAccessRow } | { status: 'not_found' }
> {
  const mutation = database
    .prepare(
      `
        UPDATE emergency_access
        SET
          status = 1,
          grantee_user_id = ?,
          email_normalized = NULL,
          invite_token_hash = NULL,
          invite_expires_at = NULL,
          revision_date = ?,
          updated_at = ?
        WHERE id = ?
          AND status = 0
          AND email_normalized = ?
          AND invite_token_hash = ?
          AND invite_expires_at > ?
          AND grantor_user_id <> ?
        RETURNING ${contactProjection}
      `,
    )
    .bind(
      input.granteeUserId,
      input.now,
      input.now,
      input.id,
      input.emailNormalized,
      input.inviteTokenHash,
      input.now,
      input.granteeUserId,
    )
  const result = successAuditEvent
    ? await runAuditedEmergencyAccessMutation(
        database,
        mutation,
        successAuditEvent,
      )
    : await mutation.all<EmergencyAccessRow>()
  const contact = result.results[0]
  if (!contact || result.meta.changes !== 1) {
    return { status: 'not_found' }
  }

  return { status: 'accepted', contact }
}

export async function confirmAcceptedEmergencyAccess(
  database: EmergencyAccessMutationDatabase,
  input: ConfirmAcceptedEmergencyAccessInput,
  successAuditEvent?: AuditEvent,
): Promise<
  { status: 'confirmed'; contact: EmergencyAccessRow } | { status: 'not_found' }
> {
  const mutation = database
    .prepare(
      `
        UPDATE emergency_access
        SET
          status = 2,
          key_encrypted = ?,
          key_generation = ?,
          revision_date = ?,
          updated_at = ?
        WHERE id = ?
          AND grantor_user_id = ?
          AND status = 1
          AND grantee_user_id IS NOT NULL
          AND key_encrypted IS NULL
        RETURNING ${contactProjection}
      `,
    )
    .bind(
      input.keyEncrypted,
      input.keyGeneration,
      input.now,
      input.now,
      input.id,
      input.grantorUserId,
    )
  const result = successAuditEvent
    ? await runAuditedEmergencyAccessMutation(
        database,
        mutation,
        successAuditEvent,
      )
    : await mutation.all<EmergencyAccessRow>()
  const contact = result.results[0]
  if (!contact || result.meta.changes !== 1) {
    return { status: 'not_found' }
  }

  return { status: 'confirmed', contact }
}

export async function reinviteEmergencyAccess(
  database: EmergencyAccessMutationDatabase,
  input: ReinviteEmergencyAccessInput,
  successAuditEvent?: AuditEvent,
): Promise<
  { status: 'reinvited'; contact: EmergencyAccessRow } | { status: 'not_found' }
> {
  const mutation = database
    .prepare(
      `
        UPDATE emergency_access
        SET
          invite_token_hash = ?,
          invite_expires_at = ?,
          revision_date = ?,
          updated_at = ?
        WHERE id = ?
          AND grantor_user_id = ?
          AND status = 0
        RETURNING ${contactProjection}
      `,
    )
    .bind(
      input.inviteTokenHash,
      input.inviteExpiresAt,
      input.now,
      input.now,
      input.id,
      input.grantorUserId,
    )
  const result = successAuditEvent
    ? await runAuditedEmergencyAccessMutation(
        database,
        mutation,
        successAuditEvent,
      )
    : await mutation.all<EmergencyAccessRow>()
  const contact = result.results[0]
  if (!contact || result.meta.changes !== 1) {
    return { status: 'not_found' }
  }

  return { status: 'reinvited', contact }
}

export async function updateEmergencyAccess(
  database: EmergencyAccessMutationDatabase,
  input: UpdateEmergencyAccessInput,
  successAuditEvent?: AuditEvent,
): Promise<
  { status: 'updated'; contact: EmergencyAccessRow } | { status: 'not_found' }
> {
  const mutation = database
    .prepare(
      `
        UPDATE emergency_access
        SET
          type = ?,
          wait_time_days = ?,
          key_encrypted = CASE
            WHEN ? IS NOT NULL AND status = 2 THEN ?
            ELSE key_encrypted
          END,
          revision_date = ?,
          updated_at = ?
        WHERE id = ?
          AND grantor_user_id = ?
          AND status IN (0, 1, 2)
          AND recovery_initiated_at IS NULL
        RETURNING ${contactProjection}
      `,
    )
    .bind(
      input.type,
      input.waitTimeDays,
      input.keyEncrypted,
      input.keyEncrypted,
      input.now,
      input.now,
      input.id,
      input.grantorUserId,
    )
  const result = successAuditEvent
    ? await runAuditedEmergencyAccessMutation(
        database,
        mutation,
        successAuditEvent,
      )
    : await mutation.all<EmergencyAccessRow>()
  const contact = result.results[0]
  if (!contact || result.meta.changes !== 1) {
    return { status: 'not_found' }
  }

  return { status: 'updated', contact }
}

export async function deleteEmergencyAccess(
  database: EmergencyAccessMutationDatabase,
  input: DeleteEmergencyAccessInput,
  successAuditEvent?: AuditEvent,
): Promise<{ status: 'deleted' } | { status: 'not_found' }> {
  const actorColumn =
    input.role === 'grantor' ? 'grantor_user_id' : 'grantee_user_id'
  const mutation = database
    .prepare(
      `
        DELETE FROM emergency_access
        WHERE id = ?
          AND ${actorColumn} = ?
      `,
    )
    .bind(input.id, input.actorUserId)
  const result = successAuditEvent
    ? await runAuditedEmergencyAccessMutation(
        database,
        mutation,
        successAuditEvent,
      )
    : await mutation.run()

  return result.meta.changes === 1
    ? { status: 'deleted' }
    : { status: 'not_found' }
}

export async function listTrustedEmergencyAccess(
  database: EmergencyAccessReadDatabase,
  grantorUserId: string,
): Promise<EmergencyAccessRow[]> {
  const result = await database
    .prepare(
      `
        SELECT
          emergency_access.id,
          emergency_access.grantor_user_id AS grantorUserId,
          emergency_access.grantee_user_id AS granteeUserId,
          COALESCE(
            emergency_access.email_normalized,
            grantee.email_normalized
          ) AS emailNormalized,
          emergency_access.type,
          emergency_access.status,
          emergency_access.wait_time_days AS waitTimeDays,
          emergency_access.created_at AS createdAt,
          emergency_access.revision_date AS revisionDate,
          emergency_access.updated_at AS updatedAt,
          emergency_access.key_generation AS keyGeneration
        FROM emergency_access
        LEFT JOIN users grantee
          ON grantee.id = emergency_access.grantee_user_id
        WHERE emergency_access.grantor_user_id = ?
        ORDER BY emergency_access.created_at ASC, emergency_access.id ASC
      `,
    )
    .bind(grantorUserId)
    .all<EmergencyAccessRow>()

  return result.results
}

export async function listGrantedEmergencyAccess(
  database: EmergencyAccessReadDatabase,
  granteeUserId: string,
): Promise<EmergencyAccessRow[]> {
  const result = await database
    .prepare(
      `
        SELECT ${contactProjection}
        FROM emergency_access
        WHERE grantee_user_id = ?
        ORDER BY created_at ASC, id ASC
      `,
    )
    .bind(granteeUserId)
    .all<EmergencyAccessRow>()

  return result.results
}

export async function findEmergencyAccessContact(
  database: EmergencyAccessReadDatabase,
  id: string,
): Promise<EmergencyAccessRow | null> {
  return database
    .prepare(
      `
        SELECT ${contactProjection}
        FROM emergency_access
        WHERE id = ?
        LIMIT 1
      `,
    )
    .bind(id)
    .first<EmergencyAccessRow>()
}

async function runAuditedEmergencyAccessMutation(
  database: EmergencyAccessMutationDatabase,
  mutation: D1PreparedStatement,
  successAuditEvent: AuditEvent,
): Promise<D1Result<EmergencyAccessRow>> {
  const audit = database
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
        WHERE changes() = 1
      `,
    )
    .bind(
      crypto.randomUUID(),
      successAuditEvent.schemaVersion,
      successAuditEvent.name,
      successAuditEvent.outcome,
      successAuditEvent.requestId,
      successAuditEvent.occurredAt,
      successAuditEvent.actor?.userId ?? null,
      successAuditEvent.actor?.deviceIdentifier ?? null,
      successAuditEvent.target?.type ?? null,
      successAuditEvent.target?.id ?? null,
      successAuditEvent.context
        ? JSON.stringify(successAuditEvent.context)
        : null,
    )
  const [mutationResult] = await database.batch<EmergencyAccessRow>([
    mutation,
    audit,
  ])

  if (!mutationResult) {
    throw new Error('Emergency Access mutation batch returned no result.')
  }

  return mutationResult
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error && /UNIQUE constraint failed/iu.test(error.message)
  )
}
