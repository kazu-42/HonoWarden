import type { AuditEvent } from '../domain/audit'

export type PersonalApiKeyMetadata = {
  userId: string
  createdAt: string
  rotatedAt: string | null
  lastUsedAt: string | null
  revisionDate: string
}

export type PersonalApiKeyVerifierRecord = {
  userId: string
  secretVerifier: string
  revisionDate: string
}

export type CreatePersonalApiKeyInput = {
  userId: string
  secretVerifier: string
  createdAt: string
}

export type RotatePersonalApiKeyInput = {
  userId: string
  secretVerifier: string
  rotatedAt: string
}

export type MarkPersonalApiKeyUsedInput = {
  userId: string
  expectedVerifier: string
  usedAt: string
}

type PersonalApiKeyReadDatabase = Pick<D1Database, 'prepare'>
type PersonalApiKeyMutationDatabase = Pick<D1Database, 'batch' | 'prepare'>

export async function findPersonalApiKeyMetadata(
  database: PersonalApiKeyReadDatabase,
  userId: string,
): Promise<PersonalApiKeyMetadata | null> {
  return database
    .prepare(
      `
        SELECT
          user_id as userId,
          created_at as createdAt,
          rotated_at as rotatedAt,
          last_used_at as lastUsedAt,
          revision_date as revisionDate
        FROM personal_api_keys
        WHERE user_id = ?
        LIMIT 1
      `,
    )
    .bind(userId)
    .first<PersonalApiKeyMetadata>()
}

export async function findPersonalApiKeyVerifier(
  database: PersonalApiKeyReadDatabase,
  userId: string,
): Promise<PersonalApiKeyVerifierRecord | null> {
  return database
    .prepare(
      `
        SELECT
          user_id as userId,
          secret_verifier as secretVerifier,
          revision_date as revisionDate
        FROM personal_api_keys
        WHERE user_id = ?
        LIMIT 1
      `,
    )
    .bind(userId)
    .first<PersonalApiKeyVerifierRecord>()
}

export async function createPersonalApiKey(
  database: PersonalApiKeyMutationDatabase,
  input: CreatePersonalApiKeyInput,
  successAuditEvent?: AuditEvent,
): Promise<{ status: 'created' | 'exists' }> {
  const mutation = database
    .prepare(
      `
        INSERT INTO personal_api_keys (
          user_id,
          secret_verifier,
          created_at,
          revision_date
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO NOTHING
      `,
    )
    .bind(input.userId, input.secretVerifier, input.createdAt, input.createdAt)
  const result = successAuditEvent
    ? await runAuditedPersonalApiKeyMutation(
        database,
        mutation,
        successAuditEvent,
      )
    : await mutation.run()

  return { status: result.meta.changes === 1 ? 'created' : 'exists' }
}

export async function rotatePersonalApiKey(
  database: PersonalApiKeyMutationDatabase,
  input: RotatePersonalApiKeyInput,
  successAuditEvent?: AuditEvent,
): Promise<{ status: 'rotated' | 'not_found' }> {
  const mutation = database
    .prepare(
      `
        UPDATE personal_api_keys
        SET
          secret_verifier = ?,
          rotated_at = ?,
          revision_date = ?
        WHERE user_id = ?
      `,
    )
    .bind(input.secretVerifier, input.rotatedAt, input.rotatedAt, input.userId)
  const result = successAuditEvent
    ? await runAuditedPersonalApiKeyMutation(
        database,
        mutation,
        successAuditEvent,
      )
    : await mutation.run()

  return { status: result.meta.changes === 1 ? 'rotated' : 'not_found' }
}

export async function markPersonalApiKeyUsed(
  database: PersonalApiKeyReadDatabase,
  input: MarkPersonalApiKeyUsedInput,
): Promise<boolean> {
  const result = await database
    .prepare(
      `
        UPDATE personal_api_keys
        SET last_used_at = ?
        WHERE user_id = ? AND secret_verifier = ?
      `,
    )
    .bind(input.usedAt, input.userId, input.expectedVerifier)
    .run()

  return result.meta.changes === 1
}

async function runAuditedPersonalApiKeyMutation(
  database: PersonalApiKeyMutationDatabase,
  mutation: D1PreparedStatement,
  successAuditEvent: AuditEvent,
): Promise<D1Result> {
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
  const [mutationResult] = await database.batch([mutation, audit])

  if (!mutationResult) {
    throw new Error('Personal API-key mutation batch returned no result.')
  }

  return mutationResult
}
