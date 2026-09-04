import { webAuthnPolicy } from '../domain/webauthn'

export type WebAuthnChallengePurpose =
  'registration' | 'authentication' | 'prf_key_set'

export type WebAuthnCredentialRecord = {
  id: string
  userId: string
  credentialId: string
  publicKey: string
  userHandle: string
  signCount: number
  credentialType: 'public-key'
  transports: readonly string[]
  aaguid: string
  discoverable: boolean
  backupEligible: boolean
  backupState: boolean
  prfSupported: boolean
  encryptedUserKey: string | null
  encryptedPublicKey: string | null
  encryptedPrivateKey: string | null
  name: string
  createdAt: string
  revisionDate: string
  lastUsedAt: string | null
}

export type WebAuthnChallengeRecord = {
  id: string
  tokenHash: string
  challengeHash: string
  purpose: WebAuthnChallengePurpose
  userId: string | null
  credentialId: string | null
  rpId: string
  originPolicyVersion: string
  expiresAt: string
  consumedAt: string | null
  createdAt: string
  retentionDeleteAfter: string
}

export type WebAuthnCredentialListPageInput = {
  userId: string
  limit: number
  cursor: { revisionDate: string; id: string } | null
}

export type ConsumeWebAuthnChallengeInput = {
  tokenHash: string
  purpose: WebAuthnChallengePurpose
  rpId: string
  originPolicyVersion: string
  userId: string
  credentialId: string | null
  consumedAt: string
  now: string
  challengeHash?: string
}

export type CompleteWebAuthnRegistrationInput = {
  consume: ConsumeWebAuthnChallengeInput & { challengeHash: string }
  credential: WebAuthnCredentialRecord
}

export type SuccessfulWebAuthnAssertionInput = {
  id: string
  userId: string
  nextSignCount: number
  backupEligible: boolean
  backupState: boolean
  now: string
}

export type RenameWebAuthnCredentialInput = {
  id: string
  userId: string
  name: string
  revisionDate: string
}

type WebAuthnDatabase = Pick<D1Database, 'prepare'>
type WebAuthnMutationDatabase = Pick<D1Database, 'prepare' | 'batch'>

type WebAuthnCredentialRow = Omit<
  WebAuthnCredentialRecord,
  | 'discoverable'
  | 'backupEligible'
  | 'backupState'
  | 'prfSupported'
  | 'transports'
> & {
  discoverable: number
  backupEligible: number
  backupState: number
  prfSupported: number
  transports: string
}

const credentialSelect = `
  SELECT
    id,
    user_id as userId,
    credential_id as credentialId,
    public_key as publicKey,
    user_handle as userHandle,
    sign_count as signCount,
    credential_type as credentialType,
    transports,
    aaguid,
    discoverable,
    backup_eligible as backupEligible,
    backup_state as backupState,
    prf_supported as prfSupported,
    encrypted_user_key as encryptedUserKey,
    encrypted_public_key as encryptedPublicKey,
    encrypted_private_key as encryptedPrivateKey,
    name,
    created_at as createdAt,
    revision_date as revisionDate,
    last_used_at as lastUsedAt
  FROM webauthn_credentials
`

export async function issueWebAuthnChallenge(
  database: WebAuthnDatabase,
  input: WebAuthnChallengeRecord,
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO webauthn_challenges (
          id,
          token_hash,
          challenge_hash,
          purpose,
          user_id,
          credential_id,
          rp_id,
          origin_policy_version,
          expires_at,
          consumed_at,
          created_at,
          retention_delete_after
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `,
    )
    .bind(
      input.id,
      input.tokenHash,
      input.challengeHash,
      input.purpose,
      input.userId,
      input.credentialId,
      input.rpId,
      input.originPolicyVersion,
      input.expiresAt,
      input.createdAt,
      input.retentionDeleteAfter,
    )
    .run()
}

export async function consumeWebAuthnChallenge(
  database: WebAuthnDatabase,
  input: ConsumeWebAuthnChallengeInput,
): Promise<{ status: 'consumed' } | { status: 'not_consumed' }> {
  const challengeHashPredicate = input.challengeHash
    ? 'AND challenge_hash = ?'
    : ''
  const result = await database
    .prepare(
      `
        UPDATE webauthn_challenges
        SET
          consumed_at = ?,
          user_id = COALESCE(user_id, ?)
        WHERE token_hash = ?
          AND purpose = ?
          AND rp_id = ?
          AND origin_policy_version = ?
          AND consumed_at IS NULL
          AND expires_at > ?
          AND (user_id IS NULL OR user_id = ?)
          AND (
            (? IS NULL AND credential_id IS NULL)
            OR credential_id = ?
          )
          ${challengeHashPredicate}
      `,
    )
    .bind(
      input.consumedAt,
      input.userId,
      input.tokenHash,
      input.purpose,
      input.rpId,
      input.originPolicyVersion,
      input.now,
      input.userId,
      input.credentialId,
      input.credentialId,
      ...(input.challengeHash ? [input.challengeHash] : []),
    )
    .run()

  return result.meta.changes === 1
    ? { status: 'consumed' }
    : { status: 'not_consumed' }
}

export async function createWebAuthnCredential(
  database: WebAuthnDatabase,
  input: WebAuthnCredentialRecord,
): Promise<
  | { status: 'created'; credential: WebAuthnCredentialRecord }
  | { status: 'limit_reached' }
> {
  const result = await database
    .prepare(
      `
        INSERT INTO webauthn_credentials (
          id,
          user_id,
          credential_id,
          public_key,
          user_handle,
          sign_count,
          credential_type,
          transports,
          aaguid,
          discoverable,
          backup_eligible,
          backup_state,
          prf_supported,
          encrypted_user_key,
          encrypted_public_key,
          encrypted_private_key,
          name,
          created_at,
          revision_date,
          last_used_at,
          updated_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE (
          SELECT COUNT(*)
          FROM webauthn_credentials
          WHERE user_id = ?
        ) < ?
      `,
    )
    .bind(
      input.id,
      input.userId,
      input.credentialId,
      input.publicKey,
      input.userHandle,
      input.signCount,
      input.credentialType,
      JSON.stringify(input.transports),
      input.aaguid,
      input.discoverable ? 1 : 0,
      input.backupEligible ? 1 : 0,
      input.backupState ? 1 : 0,
      input.prfSupported ? 1 : 0,
      input.encryptedUserKey,
      input.encryptedPublicKey,
      input.encryptedPrivateKey,
      input.name,
      input.createdAt,
      input.revisionDate,
      input.lastUsedAt,
      input.revisionDate,
      input.userId,
      webAuthnPolicy.maxCredentialsPerUser,
    )
    .run()

  return result.meta.changes === 1
    ? { status: 'created', credential: input }
    : { status: 'limit_reached' }
}

export async function completeWebAuthnRegistration(
  database: WebAuthnMutationDatabase,
  input: CompleteWebAuthnRegistrationInput,
): Promise<
  | { status: 'created'; credential: WebAuthnCredentialRecord }
  | { status: 'not_consumed' }
  | { status: 'limit_reached' }
  | { status: 'duplicate_credential' }
> {
  const consumeStatement = database
    .prepare(
      `
        UPDATE webauthn_challenges
        SET
          consumed_at = ?,
          user_id = COALESCE(user_id, ?)
        WHERE token_hash = ?
          AND challenge_hash = ?
          AND purpose = ?
          AND rp_id = ?
          AND origin_policy_version = ?
          AND consumed_at IS NULL
          AND expires_at > ?
          AND (user_id IS NULL OR user_id = ?)
          AND (
            (? IS NULL AND credential_id IS NULL)
            OR credential_id = ?
          )
          AND (
            SELECT COUNT(*)
            FROM webauthn_credentials
            WHERE user_id = ?
          ) < ?
          AND NOT EXISTS (
            SELECT 1
            FROM webauthn_credentials
            WHERE credential_id = ?
          )
      `,
    )
    .bind(
      input.consume.consumedAt,
      input.consume.userId,
      input.consume.tokenHash,
      input.consume.challengeHash,
      input.consume.purpose,
      input.consume.rpId,
      input.consume.originPolicyVersion,
      input.consume.now,
      input.consume.userId,
      input.consume.credentialId,
      input.consume.credentialId,
      input.consume.userId,
      webAuthnPolicy.maxCredentialsPerUser,
      input.credential.credentialId,
    )
  const insertStatement = database
    .prepare(
      `
        INSERT INTO webauthn_credentials (
          id,
          user_id,
          credential_id,
          public_key,
          user_handle,
          sign_count,
          credential_type,
          transports,
          aaguid,
          discoverable,
          backup_eligible,
          backup_state,
          prf_supported,
          encrypted_user_key,
          encrypted_public_key,
          encrypted_private_key,
          name,
          created_at,
          revision_date,
          last_used_at,
          updated_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE (
          SELECT COUNT(*)
          FROM webauthn_credentials
          WHERE user_id = ?
        ) < ?
          AND EXISTS (
            SELECT 1
            FROM webauthn_challenges
            WHERE token_hash = ?
              AND challenge_hash = ?
              AND consumed_at = ?
              AND purpose = ?
          )
          AND NOT EXISTS (
            SELECT 1
            FROM webauthn_credentials
            WHERE credential_id = ?
          )
      `,
    )
    .bind(
      input.credential.id,
      input.credential.userId,
      input.credential.credentialId,
      input.credential.publicKey,
      input.credential.userHandle,
      input.credential.signCount,
      input.credential.credentialType,
      JSON.stringify(input.credential.transports),
      input.credential.aaguid,
      input.credential.discoverable ? 1 : 0,
      input.credential.backupEligible ? 1 : 0,
      input.credential.backupState ? 1 : 0,
      input.credential.prfSupported ? 1 : 0,
      input.credential.encryptedUserKey,
      input.credential.encryptedPublicKey,
      input.credential.encryptedPrivateKey,
      input.credential.name,
      input.credential.createdAt,
      input.credential.revisionDate,
      input.credential.lastUsedAt,
      input.credential.revisionDate,
      input.credential.userId,
      webAuthnPolicy.maxCredentialsPerUser,
      input.consume.tokenHash,
      input.consume.challengeHash,
      input.consume.consumedAt,
      input.consume.purpose,
      input.credential.credentialId,
    )

  try {
    const results = await database.batch([consumeStatement, insertStatement])
    const consumed = (results[0]?.meta.changes ?? 0) === 1
    const created = (results[1]?.meta.changes ?? 0) === 1
    if (consumed && created) {
      return { status: 'created', credential: input.credential }
    }
    if (created && !consumed) {
      return { status: 'not_consumed' }
    }

    const existing = await listWebAuthnCredentialsByUser(database, {
      userId: input.credential.userId,
      limit: webAuthnPolicy.maxCredentialsPerUser,
      cursor: null,
    })
    if (existing.items.length >= webAuthnPolicy.maxCredentialsPerUser) {
      return { status: 'limit_reached' }
    }
    if (
      existing.items.some(
        (item) => item.credentialId === input.credential.credentialId,
      )
    ) {
      return { status: 'duplicate_credential' }
    }

    return { status: 'not_consumed' }
  } catch (error) {
    if (isUniqueCredentialConstraintError(error)) {
      return { status: 'duplicate_credential' }
    }

    throw error
  }
}

function isUniqueCredentialConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    /UNIQUE constraint failed/i.test(message) &&
    /webauthn_credentials/i.test(message)
  )
}

export async function findWebAuthnCredentialForOwner(
  database: WebAuthnDatabase,
  input: { id: string; userId: string },
): Promise<WebAuthnCredentialRecord | null> {
  const row = await database
    .prepare(
      `
        ${credentialSelect}
        WHERE id = ? AND user_id = ?
        LIMIT 1
      `,
    )
    .bind(input.id, input.userId)
    .first<WebAuthnCredentialRow>()

  return row ? credentialFromRow(row) : null
}

export async function findWebAuthnCredentialByCredentialId(
  database: WebAuthnDatabase,
  credentialId: string,
): Promise<WebAuthnCredentialRecord | null> {
  const row = await database
    .prepare(
      `
        ${credentialSelect}
        WHERE credential_id = ?
        LIMIT 1
      `,
    )
    .bind(credentialId)
    .first<WebAuthnCredentialRow>()

  return row ? credentialFromRow(row) : null
}

export async function listWebAuthnCredentialsByUser(
  database: WebAuthnDatabase,
  input: WebAuthnCredentialListPageInput,
): Promise<{ items: WebAuthnCredentialRecord[]; hasMore: boolean }> {
  const cursorPredicate = input.cursor
    ? 'AND (revision_date > ? OR (revision_date = ? AND id > ?))'
    : ''
  const result = await database
    .prepare(
      `
        ${credentialSelect}
        WHERE user_id = ?
          ${cursorPredicate}
        ORDER BY revision_date ASC, id ASC
        LIMIT ?
      `,
    )
    .bind(
      input.userId,
      ...(input.cursor
        ? [
            input.cursor.revisionDate,
            input.cursor.revisionDate,
            input.cursor.id,
          ]
        : []),
      input.limit + 1,
    )
    .all<WebAuthnCredentialRow>()
  const rows = result.results.map(credentialFromRow)

  return {
    items: rows.slice(0, input.limit),
    hasMore: rows.length > input.limit,
  }
}

export async function recordSuccessfulWebAuthnAssertion(
  database: WebAuthnDatabase,
  input: SuccessfulWebAuthnAssertionInput,
): Promise<{ status: 'updated' } | { status: 'not_updated' }> {
  const result = await database
    .prepare(
      `
        UPDATE webauthn_credentials
        SET
          sign_count = ?,
          backup_eligible = ?,
          backup_state = ?,
          last_used_at = ?,
          revision_date = ?,
          updated_at = ?
        WHERE id = ?
          AND user_id = ?
          AND (
            (sign_count = 0 AND ? = 0)
            OR ? > sign_count
          )
      `,
    )
    .bind(
      input.nextSignCount,
      input.backupEligible ? 1 : 0,
      input.backupState ? 1 : 0,
      input.now,
      input.now,
      input.now,
      input.id,
      input.userId,
      input.nextSignCount,
      input.nextSignCount,
    )
    .run()

  return result.meta.changes === 1
    ? { status: 'updated' }
    : { status: 'not_updated' }
}

export async function renameWebAuthnCredential(
  database: WebAuthnDatabase,
  input: RenameWebAuthnCredentialInput,
): Promise<{ status: 'updated' } | { status: 'not_found' }> {
  const result = await database
    .prepare(
      `
        UPDATE webauthn_credentials
        SET
          name = ?,
          revision_date = ?,
          updated_at = ?
        WHERE id = ? AND user_id = ?
      `,
    )
    .bind(
      input.name,
      input.revisionDate,
      input.revisionDate,
      input.id,
      input.userId,
    )
    .run()

  return result.meta.changes === 1
    ? { status: 'updated' }
    : { status: 'not_found' }
}

export async function deleteWebAuthnCredential(
  database: WebAuthnDatabase,
  input: { id: string; userId: string },
): Promise<{ status: 'deleted' } | { status: 'not_found' }> {
  const result = await database
    .prepare(
      `
        DELETE FROM webauthn_credentials
        WHERE id = ? AND user_id = ?
      `,
    )
    .bind(input.id, input.userId)
    .run()

  return result.meta.changes === 1
    ? { status: 'deleted' }
    : { status: 'not_found' }
}

export async function cleanupExpiredWebAuthnChallenges(
  database: WebAuthnDatabase,
  input: { expiredBefore: string; limit: number },
): Promise<{ deletedExpiredChallenges: number }> {
  const result = await database
    .prepare(
      `
        DELETE FROM webauthn_challenges
        WHERE id IN (
          SELECT id
          FROM webauthn_challenges
          WHERE retention_delete_after <= ?
          ORDER BY retention_delete_after ASC
          LIMIT ?
        )
      `,
    )
    .bind(input.expiredBefore, input.limit)
    .run()

  return { deletedExpiredChallenges: result.meta.changes }
}

function credentialFromRow(
  row: WebAuthnCredentialRow,
): WebAuthnCredentialRecord {
  return {
    id: row.id,
    userId: row.userId,
    credentialId: row.credentialId,
    publicKey: row.publicKey,
    userHandle: row.userHandle,
    signCount: row.signCount,
    credentialType: 'public-key',
    transports: JSON.parse(row.transports) as string[],
    aaguid: row.aaguid,
    discoverable: row.discoverable === 1,
    backupEligible: row.backupEligible === 1,
    backupState: row.backupState === 1,
    prfSupported: row.prfSupported === 1,
    encryptedUserKey: row.encryptedUserKey,
    encryptedPublicKey: row.encryptedPublicKey,
    encryptedPrivateKey: row.encryptedPrivateKey,
    name: row.name,
    createdAt: row.createdAt,
    revisionDate: row.revisionDate,
    lastUsedAt: row.lastUsedAt,
  }
}
