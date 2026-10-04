import { generateTotpCredentialGeneration } from '../domain/mfa-session'

export type TotpSetupRecord = {
  userId: string
  encryptedSecret: string
  enabled: boolean
  verifiedAt: string | null
  lastAcceptedStep: number | null
  credentialGeneration?: string | null
  pendingEncryptedSecret: string | null
  pendingCreatedAt: string | null
  createdAt: string
  updatedAt: string
}

export type PendingTotpSetupInput = {
  userId: string
  encryptedSecret: string
  now: string
}

export type EnableTotpSetupInput = {
  userId: string
  verifiedAt: string
  expectedEncryptedSecret?: string
}

export type DisableTotpSetupInput = {
  userId: string
  expectedCredentialGeneration?: string
}

export type PendingTotpChangeInput = {
  userId: string
  encryptedSecret: string
  now: string
  expectedCredentialGeneration?: string
}

export type PromoteTotpChangeInput = {
  userId: string
  acceptedStep: number
  verifiedAt: string
  expectedCredentialGeneration?: string
  expectedPendingEncryptedSecret?: string
}

export type AcceptTotpStepInput = {
  userId: string
  acceptedStep: number
  now: string
  expectedCredentialGeneration?: string
}

export type TotpChallengeRecord = {
  id: string
  userId: string
  challengeHash: string
  deviceIdentifier: string
  expiresAt: string
  consumedAt: string | null
  createdAt: string
}

export type TotpChallengeInput = {
  id: string
  userId: string
  challengeHash: string
  deviceIdentifier: string
  expiresAt: string
  createdAt: string
}

export type ConsumeTotpChallengeInput = {
  challengeId: string
  consumedAt: string
}

export type TotpChallengeCleanupInput = {
  expiredBefore: string
  limit: number
}

export type TotpChallengeCleanupResult = {
  deletedExpiredChallenges: number
}

type TotpDatabase = Pick<D1Database, 'prepare'>

type TotpSetupRow = {
  userId: string
  encryptedSecret: string
  enabled: number
  verifiedAt: string | null
  lastAcceptedStep: number | null
  credentialGeneration?: string | null
  pendingEncryptedSecret: string | null
  pendingCreatedAt: string | null
  createdAt: string
  updatedAt: string
}

type TotpChallengeRow = {
  id: string
  userId: string
  challengeHash: string
  deviceIdentifier: string
  expiresAt: string
  consumedAt: string | null
  createdAt: string
}

export async function upsertPendingTotpSetup(
  database: TotpDatabase,
  input: PendingTotpSetupInput,
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO user_totp (
          user_id,
          encrypted_secret,
          enabled,
          verified_at,
          last_accepted_step,
          created_at,
          updated_at
        )
        VALUES (?, ?, 0, NULL, NULL, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          encrypted_secret = excluded.encrypted_secret,
          enabled = 0,
          verified_at = NULL,
          last_accepted_step = NULL,
          credential_generation = NULL,
          pending_encrypted_secret = NULL,
          pending_created_at = NULL,
          updated_at = excluded.updated_at
        WHERE user_totp.enabled = 0
      `,
    )
    .bind(input.userId, input.encryptedSecret, input.now, input.now)
    .run()
}

export async function findTotpSetupByUserId(
  database: TotpDatabase,
  userId: string,
): Promise<TotpSetupRecord | null> {
  const row = await database
    .prepare(
      `
        SELECT
          user_id as userId,
          encrypted_secret as encryptedSecret,
          enabled,
          verified_at as verifiedAt,
          last_accepted_step as lastAcceptedStep,
          credential_generation as credentialGeneration,
          pending_encrypted_secret as pendingEncryptedSecret,
          pending_created_at as pendingCreatedAt,
          created_at as createdAt,
          updated_at as updatedAt
        FROM user_totp
        WHERE user_id = ?
        LIMIT 1
      `,
    )
    .bind(userId)
    .first<TotpSetupRow>()

  return row ? totpSetupFromRow(row) : null
}

export async function enableTotpSetup(
  database: TotpDatabase,
  input: EnableTotpSetupInput,
): Promise<boolean> {
  const result = await database
    .prepare(
      `
        UPDATE user_totp
        SET
          enabled = 1,
          verified_at = ?,
          updated_at = ?,
          credential_generation = ?
        WHERE user_id = ? AND enabled = 0
          ${input.expectedEncryptedSecret === undefined ? '' : 'AND encrypted_secret = ?'}
      `,
    )
    .bind(
      input.verifiedAt,
      input.verifiedAt,
      generateTotpCredentialGeneration(),
      input.userId,
      ...(input.expectedEncryptedSecret === undefined
        ? []
        : [input.expectedEncryptedSecret]),
    )
    .run()

  return result.meta.changes >= 1
}

export async function disableTotpSetup(
  database: TotpDatabase,
  input: DisableTotpSetupInput,
): Promise<boolean> {
  const result = await database
    .prepare(
      `
        DELETE FROM user_totp
        WHERE user_id = ?
          AND enabled = 1
          ${input.expectedCredentialGeneration === undefined ? '' : 'AND credential_generation = ?'}
          AND ${lastEnrolledOwnerCanRemoveTotpSql}
      `,
    )
    .bind(
      input.userId,
      ...(input.expectedCredentialGeneration === undefined
        ? []
        : [input.expectedCredentialGeneration]),
    )
    .run()

  return result.meta.changes >= 1
}

export async function startPendingTotpChange(
  database: TotpDatabase,
  input: PendingTotpChangeInput,
): Promise<boolean> {
  const result = await database
    .prepare(
      `
        UPDATE user_totp
        SET
          pending_encrypted_secret = ?,
          pending_created_at = ?,
          updated_at = ?
        WHERE user_id = ?
          AND enabled = 1
          ${input.expectedCredentialGeneration === undefined ? '' : 'AND credential_generation = ?'}
      `,
    )
    .bind(
      input.encryptedSecret,
      input.now,
      input.now,
      input.userId,
      ...(input.expectedCredentialGeneration === undefined
        ? []
        : [input.expectedCredentialGeneration]),
    )
    .run()

  return result.meta.changes === 1
}

export async function promotePendingTotpChange(
  database: TotpDatabase,
  input: PromoteTotpChangeInput,
): Promise<boolean> {
  const result = await database
    .prepare(
      `
        UPDATE user_totp
        SET
          encrypted_secret = pending_encrypted_secret,
          verified_at = ?,
          last_accepted_step = ?,
          credential_generation = ?,
          pending_encrypted_secret = NULL,
          pending_created_at = NULL,
          updated_at = ?
        WHERE user_id = ?
          AND enabled = 1
          AND pending_encrypted_secret IS NOT NULL
          ${input.expectedCredentialGeneration === undefined ? '' : 'AND credential_generation = ?'}
          ${input.expectedPendingEncryptedSecret === undefined ? '' : 'AND pending_encrypted_secret = ?'}
      `,
    )
    .bind(
      input.verifiedAt,
      input.acceptedStep,
      generateTotpCredentialGeneration(),
      input.verifiedAt,
      input.userId,
      ...(input.expectedCredentialGeneration === undefined
        ? []
        : [input.expectedCredentialGeneration]),
      ...(input.expectedPendingEncryptedSecret === undefined
        ? []
        : [input.expectedPendingEncryptedSecret]),
    )
    .run()

  return result.meta.changes >= 1
}

export async function recordAcceptedTotpStep(
  database: TotpDatabase,
  input: AcceptTotpStepInput,
): Promise<boolean> {
  const result = await database
    .prepare(
      `
        UPDATE user_totp
        SET
          last_accepted_step = ?,
          updated_at = ?
        WHERE user_id = ?
          AND (last_accepted_step IS NULL OR ? > last_accepted_step)
          ${input.expectedCredentialGeneration === undefined ? '' : 'AND enabled = 1 AND verified_at IS NOT NULL AND credential_generation = ?'}
      `,
    )
    .bind(
      input.acceptedStep,
      input.now,
      input.userId,
      input.acceptedStep,
      ...(input.expectedCredentialGeneration === undefined
        ? []
        : [input.expectedCredentialGeneration]),
    )
    .run()

  return result.meta.changes === 1
}

export async function createTotpChallenge(
  database: TotpDatabase,
  input: TotpChallengeInput,
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO totp_challenges (
          id,
          user_id,
          challenge_hash,
          device_identifier,
          expires_at,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      input.id,
      input.userId,
      input.challengeHash,
      input.deviceIdentifier,
      input.expiresAt,
      input.createdAt,
    )
    .run()
}

export async function findActiveTotpChallengeByHash(
  database: TotpDatabase,
  challengeHash: string,
  now: string,
): Promise<TotpChallengeRecord | null> {
  const row = await database
    .prepare(
      `
        SELECT
          id,
          user_id as userId,
          challenge_hash as challengeHash,
          device_identifier as deviceIdentifier,
          expires_at as expiresAt,
          consumed_at as consumedAt,
          created_at as createdAt
        FROM totp_challenges
        WHERE challenge_hash = ?
          AND consumed_at IS NULL
        AND expires_at > ?
        LIMIT 1
      `,
    )
    .bind(challengeHash, now)
    .first<TotpChallengeRow>()

  return row ? totpChallengeFromRow(row) : null
}

export async function consumeTotpChallenge(
  database: TotpDatabase,
  input: ConsumeTotpChallengeInput,
): Promise<boolean> {
  const result = await database
    .prepare(
      `
        UPDATE totp_challenges
        SET
          consumed_at = ?
        WHERE id = ?
          AND consumed_at IS NULL
      `,
    )
    .bind(input.consumedAt, input.challengeId)
    .run()

  return result.meta.changes === 1
}

export async function cleanupExpiredTotpChallenges(
  database: TotpDatabase,
  input: TotpChallengeCleanupInput,
): Promise<TotpChallengeCleanupResult> {
  const result = await database
    .prepare(
      `
        DELETE FROM totp_challenges
        WHERE id IN (
          SELECT id
          FROM totp_challenges
          WHERE (consumed_at IS NOT NULL OR expires_at < ?)
          ORDER BY expires_at ASC
          LIMIT ?
        )
      `,
    )
    .bind(input.expiredBefore, input.limit)
    .run()

  return {
    deletedExpiredChallenges: result.meta.changes,
  }
}

function totpSetupFromRow(row: TotpSetupRow): TotpSetupRecord {
  return {
    userId: row.userId,
    encryptedSecret: row.encryptedSecret,
    enabled: row.enabled === 1,
    verifiedAt: row.verifiedAt,
    lastAcceptedStep: row.lastAcceptedStep ?? null,
    ...(row.credentialGeneration === undefined
      ? {}
      : { credentialGeneration: row.credentialGeneration }),
    pendingEncryptedSecret: row.pendingEncryptedSecret ?? null,
    pendingCreatedAt: row.pendingCreatedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// Count enrollment, not online sessions: a surviving enrolled Owner can log in
// or step up again. Every enabled policy must retain such an active Owner.
export const lastEnrolledOwnerCanRemoveTotpSql = `
  NOT EXISTS (
    SELECT 1 FROM organization_users current_owner
    INNER JOIN organizations o ON o.id = current_owner.organization_id
    INNER JOIN organization_policies p ON p.organization_id = o.id
      AND p.type = 0 AND p.enabled = 1
    WHERE current_owner.user_id = user_totp.user_id
      AND current_owner.status = 2 AND current_owner.type = 0 AND o.enabled = 1
      AND NOT EXISTS (
        SELECT 1 FROM organization_users survivor
        INNER JOIN users active_user ON active_user.id = survivor.user_id
          AND active_user.disabled_at IS NULL
        INNER JOIN user_totp factor ON factor.user_id = survivor.user_id
          AND factor.enabled = 1 AND factor.verified_at IS NOT NULL
          AND factor.credential_generation IS NOT NULL
        WHERE survivor.organization_id = current_owner.organization_id
          AND survivor.status = 2 AND survivor.type = 0
          AND survivor.user_id <> current_owner.user_id
      )
  )
`

function totpChallengeFromRow(row: TotpChallengeRow): TotpChallengeRecord {
  return {
    id: row.id,
    userId: row.userId,
    challengeHash: row.challengeHash,
    deviceIdentifier: row.deviceIdentifier,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt ?? null,
    createdAt: row.createdAt,
  }
}
