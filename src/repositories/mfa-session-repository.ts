import {
  generateTotpCredentialGeneration,
  isValidTotpSessionVerification,
} from '../domain/mfa-session'
import type {
  MfaSessionActor,
  TotpSessionVerification,
} from '../domain/mfa-session'
import { lastEnrolledOwnerCanRemoveTotpSql } from './totp-repository'

type MfaDatabase = Pick<D1Database, 'prepare' | 'batch'>

type TotpStepUpInput = MfaSessionActor &
  TotpSessionVerification & { now: string }
type TotpChangeStartInput = TotpStepUpInput & { encryptedSecret: string }
type TotpSetupStartInput = MfaSessionActor & {
  encryptedSecret: string
  now: string
}
type TotpEnrollmentInput = MfaSessionActor & {
  expectedEncryptedSecret: string
  acceptedStep: number
  verifiedAt: string
}
type TotpPromotionInput = MfaSessionActor & {
  expectedCredentialGeneration: string
  expectedPendingEncryptedSecret: string
  acceptedStep: number
  verifiedAt: string
}
type TotpDisableInput = MfaSessionActor & {
  expectedCredentialGeneration: string
  now: string
  auditId: string
  requestId: string
}

// This predicate is also used by the consume write, so a stale bearer cannot
// burn a valid TOTP step after its device has logged into a different family.
const activeSessionSql = `
  EXISTS (
    SELECT 1 FROM devices d
    INNER JOIN users u ON u.id = d.user_id AND u.disabled_at IS NULL
    WHERE d.user_id = user_totp.user_id
      AND d.identifier = ? AND d.session_id = ?
      AND d.revoked_at IS NULL
  )
`

export async function findSessionTotpAssurance(
  database: Pick<D1Database, 'prepare'>,
  actor: MfaSessionActor,
): Promise<boolean> {
  const row = await database
    .prepare(
      `
      SELECT 1 AS assured
      FROM devices d
      INNER JOIN users u ON u.id = d.user_id AND u.disabled_at IS NULL
      INNER JOIN user_totp ut ON ut.user_id = d.user_id
      WHERE d.user_id = ? AND d.identifier = ? AND d.session_id = ?
        AND d.revoked_at IS NULL
        AND ut.enabled = 1 AND ut.verified_at IS NOT NULL
        AND ut.credential_generation IS NOT NULL
        AND d.mfa_totp_credential_generation = ut.credential_generation
        AND d.mfa_verified_at IS NOT NULL
      LIMIT 1
    `,
    )
    .bind(actor.userId, actor.deviceIdentifier, actor.sessionId)
    .first<{ assured: number }>()

  return row?.assured === 1
}

export async function consumeTotpSessionStepUp(
  database: MfaDatabase,
  input: TotpStepUpInput,
): Promise<boolean> {
  if (!isValidTotpSessionVerification(input)) return false

  const results = await database.batch([
    consumeStepStatement(database, input),
    sessionProofStatement(
      database,
      input,
      input.credentialGeneration,
      input.now,
    ),
  ])

  return completedProofBatch(results)
}

export async function createPendingTotpSetupForSession(
  database: Pick<D1Database, 'prepare'>,
  input: TotpSetupStartInput,
): Promise<boolean> {
  const result = await database
    .prepare(
      `
      INSERT INTO user_totp (
        user_id, encrypted_secret, enabled, verified_at, last_accepted_step,
        created_at, updated_at
      )
      SELECT ?, ?, 0, NULL, NULL, ?, ?
      FROM devices d
      INNER JOIN users u ON u.id = d.user_id AND u.disabled_at IS NULL
      WHERE d.user_id = ? AND d.identifier = ? AND d.session_id = ?
        AND d.revoked_at IS NULL
      ON CONFLICT(user_id) DO UPDATE SET
        encrypted_secret = excluded.encrypted_secret,
        verified_at = NULL, last_accepted_step = NULL,
        credential_generation = NULL, pending_encrypted_secret = NULL,
        pending_created_at = NULL, updated_at = excluded.updated_at
      WHERE user_totp.enabled = 0
      RETURNING user_id
    `,
    )
    .bind(
      input.userId,
      input.encryptedSecret,
      input.now,
      input.now,
      input.userId,
      input.deviceIdentifier,
      input.sessionId,
    )
    .run<{ user_id: string }>()
  // Direct returned rows are authoritative when invalidation triggers also write.
  return result.results.length === 1
}

export async function startPendingTotpChangeForSession(
  database: MfaDatabase,
  input: TotpChangeStartInput,
): Promise<boolean> {
  if (!isValidTotpSessionVerification(input)) return false
  const results = await database.batch([
    consumeStepStatement(database, input),
    database
      .prepare(
        `
      UPDATE user_totp
      SET pending_encrypted_secret = ?, pending_created_at = ?, updated_at = ?
      WHERE changes() = 1 AND user_id = ? AND enabled = 1
        AND credential_generation = ? AND ${activeSessionSql}
    `,
      )
      .bind(
        input.encryptedSecret,
        input.now,
        input.now,
        input.userId,
        input.credentialGeneration,
        input.deviceIdentifier,
        input.sessionId,
      ),
    sessionProofStatement(
      database,
      input,
      input.credentialGeneration,
      input.now,
    ),
  ])
  return completedProofBatch(results, 3)
}

export async function enableTotpSetupForSession(
  database: MfaDatabase,
  input: TotpEnrollmentInput,
): Promise<boolean> {
  const generation = generateTotpCredentialGeneration()
  if (
    !isValidTotpSessionVerification({
      credentialGeneration: generation,
      acceptedStep: input.acceptedStep,
    })
  )
    return false

  const results = await database.batch([
    database
      .prepare(
        `
        UPDATE user_totp
        SET enabled = 1, verified_at = ?, last_accepted_step = ?,
          credential_generation = ?, updated_at = ?
        WHERE user_id = ? AND enabled = 0 AND encrypted_secret = ?
          AND (last_accepted_step IS NULL OR ? > last_accepted_step)
          AND ${activeSessionSql}
      `,
      )
      .bind(
        input.verifiedAt,
        input.acceptedStep,
        generation,
        input.verifiedAt,
        input.userId,
        input.expectedEncryptedSecret,
        input.acceptedStep,
        input.deviceIdentifier,
        input.sessionId,
      ),
    sessionProofStatement(database, input, generation, input.verifiedAt),
  ])

  return completedProofBatch(results)
}

export async function promotePendingTotpChangeForSession(
  database: MfaDatabase,
  input: TotpPromotionInput,
): Promise<boolean> {
  if (
    !isValidTotpSessionVerification({
      credentialGeneration: input.expectedCredentialGeneration,
      acceptedStep: input.acceptedStep,
    })
  )
    return false
  const generation = generateTotpCredentialGeneration()

  const results = await database.batch([
    database
      .prepare(
        `
        UPDATE user_totp
        SET encrypted_secret = pending_encrypted_secret,
          verified_at = ?, last_accepted_step = ?, credential_generation = ?,
          pending_encrypted_secret = NULL, pending_created_at = NULL,
          updated_at = ?
        WHERE user_id = ? AND enabled = 1 AND verified_at IS NOT NULL
          AND credential_generation = ? AND pending_encrypted_secret = ?
          AND ${activeSessionSql}
      `,
      )
      .bind(
        input.verifiedAt,
        input.acceptedStep,
        generation,
        input.verifiedAt,
        input.userId,
        input.expectedCredentialGeneration,
        input.expectedPendingEncryptedSecret,
        input.deviceIdentifier,
        input.sessionId,
      ),
    sessionProofStatement(database, input, generation, input.verifiedAt),
  ])

  return completedProofBatch(results)
}

export async function disableTotpSetupForSession(
  database: MfaDatabase,
  input: TotpDisableInput,
): Promise<boolean> {
  const results = await database.batch([
    database
      .prepare(
        `
      DELETE FROM user_totp
      WHERE user_id = ? AND enabled = 1 AND credential_generation = ?
        AND ${activeSessionSql}
        AND ${lastEnrolledOwnerCanRemoveTotpSql}
      RETURNING user_id
    `,
      )
      .bind(
        input.userId,
        input.expectedCredentialGeneration,
        input.deviceIdentifier,
        input.sessionId,
      ),
    // DELETE's direct changes() count excludes the invalidation trigger writes.
    database
      .prepare(
        `
      UPDATE users SET revision_date = ?, updated_at = ?
      WHERE id = ? AND disabled_at IS NULL AND changes() = 1
    `,
      )
      .bind(input.now, input.now, input.userId),
    database
      .prepare(
        `
      INSERT INTO audit_events (
        id, schema_version, name, outcome, request_id, occurred_at,
        actor_user_id, actor_device_identifier, target_type, target_id, context_json
      )
      SELECT ?, 1, 'totp.disable', 'success', ?, ?, ?, ?, 'account', ?, ?
      WHERE changes() = 1
    `,
      )
      .bind(
        input.auditId,
        input.requestId,
        input.now,
        input.userId,
        input.deviceIdentifier,
        input.userId,
        JSON.stringify({ enabled: false }),
      ),
  ])
  if (results.length !== 3)
    throw new Error('TOTP disable batch returned an invalid result count.')
  const deleted = results[0]?.results.length === 1
  if (deleted && results[2]?.meta.changes !== 1)
    throw new Error(
      'TOTP disable batch did not record its required audit event.',
    )
  return deleted
}

function sessionProofStatement(
  database: Pick<D1Database, 'prepare'>,
  actor: MfaSessionActor,
  generation: string,
  verifiedAt: string,
): D1PreparedStatement {
  return database
    .prepare(
      `
      UPDATE devices
      SET mfa_totp_credential_generation = ?, mfa_verified_at = ?
      WHERE changes() = 1
        AND user_id = ? AND identifier = ? AND session_id = ?
        AND revoked_at IS NULL
        AND EXISTS (
          SELECT 1 FROM user_totp ut
          WHERE ut.user_id = devices.user_id AND ut.enabled = 1
            AND ut.verified_at IS NOT NULL AND ut.credential_generation = ?
        )
    `,
    )
    .bind(
      generation,
      verifiedAt,
      actor.userId,
      actor.deviceIdentifier,
      actor.sessionId,
      generation,
    )
}

function consumeStepStatement(
  database: Pick<D1Database, 'prepare'>,
  input: TotpStepUpInput,
): D1PreparedStatement {
  return database
    .prepare(
      `
    UPDATE user_totp
    SET last_accepted_step = ?, updated_at = ?
    WHERE user_id = ? AND enabled = 1 AND verified_at IS NOT NULL
      AND credential_generation = ?
      AND (last_accepted_step IS NULL OR ? > last_accepted_step)
      AND ${activeSessionSql}
  `,
    )
    .bind(
      input.acceptedStep,
      input.now,
      input.userId,
      input.credentialGeneration,
      input.acceptedStep,
      input.deviceIdentifier,
      input.sessionId,
    )
}

function completedProofBatch(results: D1Result[], expectedCount = 2): boolean {
  if (results.length !== expectedCount)
    throw new Error(
      'TOTP session proof batch returned an invalid result count.',
    )
  // Trigger writes contribute to D1 meta.changes; the final proof UPDATE has
  // no trigger and identifies exactly one active immutable family.
  const proofChanges = results[results.length - 1]?.meta.changes ?? 0
  if (proofChanges > 1)
    throw new Error('TOTP session proof batch updated multiple families.')
  return proofChanges === 1
}
