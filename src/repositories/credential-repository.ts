import type { AuditEvent } from '../domain/audit'
import { fingerprintCredentialWrapper } from '../domain/account-credentials'
import {
  insertCredentialWrapperHistorySql,
  insertInitializedAccountWrapperHistorySql,
} from './credential-wrapper-history-sql'

type CredentialRepositoryDatabase = Pick<D1Database, 'batch' | 'prepare'>

export type InitializeAccountKeyPairInput = {
  userId: string
  expectedUserKey: string
  expectedSecurityStamp: string
  expectedRevisionDate: string
  publicKey: string
  wrappedPrivateKey: string
  nextRevisionDate: string
  auditEventId: string
  auditEvent: AuditEvent
}

export type InitializeAccountKeyPairResult =
  | {
      status: 'initialized'
      securityStamp: string
      revisionDate: string
      auditEventId: string
    }
  | { status: 'conflict' }

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

export type ChangeAccountMasterPasswordInput =
  RotateAccountSecurityStampInput & {
    expectedEmailNormalized: string
    expectedKdfAlgorithm: string
    expectedKdfIterations: number
    expectedKdfMemory: number | null
    expectedKdfParallelism: number | null
    expectedUserKey: string | null
    expectedPrivateKey: string | null
    nextMasterPasswordHash: string
    nextUserKey: string
  }

export type ChangeAccountMasterPasswordResult =
  | ({ status: 'changed' } & CredentialGenerationMutationResult)
  | { status: 'conflict' }

export type ChangeAccountKdfInput = ChangeAccountMasterPasswordInput & {
  nextKdfAlgorithm: 'pbkdf2-sha256' | 'argon2id'
  nextKdfIterations: number
  nextKdfMemory: number | null
  nextKdfParallelism: number | null
}

export type ChangeAccountKdfResult =
  | ({ status: 'changed' } & CredentialGenerationMutationResult)
  | { status: 'conflict' }

type CredentialGenerationMutationResult = {
  securityStamp: string
  revisionDate: string
  revokedDeviceCount: number
  revokedRefreshTokenCount: number
  invalidatedAuthRequestCount: number
  auditEventId: string
}

type UpdatedUserRow = {
  id: string
}

type CredentialWrapperHistoryRow = {
  wrapperKind: 'user_key' | 'private_key'
  wrapperSha256: string
}

type CredentialWrapperHistoryMutation = {
  statement: D1PreparedStatement
  allowedWrapperSha256: ReadonlySet<string>
  nextWrapperSha256: string
}

export async function initializeAccountKeyPair(
  database: CredentialRepositoryDatabase,
  input: InitializeAccountKeyPairInput,
): Promise<InitializeAccountKeyPairResult> {
  const event = input.auditEvent
  const [expectedUserKeySha256, wrappedPrivateKeySha256] = await Promise.all([
    fingerprintCredentialWrapper(input.expectedUserKey),
    fingerprintCredentialWrapper(input.wrappedPrivateKey),
  ])
  if (expectedUserKeySha256 === wrappedPrivateKeySha256) {
    return { status: 'conflict' }
  }
  const wrapperHistoryEntries = [
    { kind: 'user_key', sha256: expectedUserKeySha256 },
    { kind: 'private_key', sha256: wrappedPrivateKeySha256 },
  ] as const
  const results = await database.batch([
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
            AND user_key IS NOT NULL
            AND length(trim(user_key)) > 0
            AND user_key = ?
            AND public_key IS NULL
            AND private_key IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM user_key_rotation_wrapper_history
              WHERE user_id = ? AND wrapper_sha256 = ?
            )
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
        input.expectedUserKey,
        input.userId,
        wrappedPrivateKeySha256,
        input.expectedSecurityStamp,
        input.expectedRevisionDate,
      ),
    database
      .prepare(
        `
          UPDATE users
          SET
            public_key = ?,
            private_key = ?,
            revision_date = ?,
            updated_at = ?
          WHERE id = ?
            AND disabled_at IS NULL
            AND user_key IS NOT NULL
            AND length(trim(user_key)) > 0
            AND user_key = ?
            AND public_key IS NULL
            AND private_key IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM user_key_rotation_wrapper_history
              WHERE user_id = ? AND wrapper_sha256 = ?
            )
            AND security_stamp = ?
            AND revision_date = ?
          RETURNING id
        `,
      )
      .bind(
        input.publicKey,
        input.wrappedPrivateKey,
        input.nextRevisionDate,
        input.nextRevisionDate,
        input.userId,
        input.expectedUserKey,
        input.userId,
        wrappedPrivateKeySha256,
        input.expectedSecurityStamp,
        input.expectedRevisionDate,
      ),
    database
      .prepare(insertInitializedAccountWrapperHistorySql)
      .bind(
        JSON.stringify(wrapperHistoryEntries),
        input.userId,
        input.nextRevisionDate,
        input.userId,
        input.expectedUserKey,
        input.publicKey,
        input.wrappedPrivateKey,
        input.expectedSecurityStamp,
        input.nextRevisionDate,
      ),
  ])

  if (results.length !== 3) {
    throw new Error(
      'account key initialization batch returned an invalid result count',
    )
  }

  const [auditResult, userResult, wrapperHistoryResult] = results
  const updatedUsers = (userResult?.results ?? []) as UpdatedUserRow[]
  const wrapperHistoryRows = (wrapperHistoryResult?.results ??
    []) as CredentialWrapperHistoryRow[]
  const userChanges = updatedUsers.length
  const auditChanges = auditResult?.meta.changes ?? 0
  const wrapperHistoryChanges = wrapperHistoryResult?.meta.changes ?? 0
  if (userChanges === 0) {
    if (
      auditChanges !== 0 ||
      wrapperHistoryChanges !== 0 ||
      wrapperHistoryRows.length !== 0
    ) {
      throw new Error('account key initialization guard invariant was violated')
    }
    return { status: 'conflict' }
  }
  if (
    !userResult?.success ||
    userChanges !== 1 ||
    updatedUsers[0]?.id !== input.userId ||
    !auditResult?.success ||
    auditChanges !== 1 ||
    !wrapperHistoryResult?.success ||
    wrapperHistoryChanges < 1 ||
    wrapperHistoryChanges > wrapperHistoryEntries.length ||
    wrapperHistoryRows.length !== wrapperHistoryChanges ||
    !wrapperHistoryRows.some(
      (row) =>
        row.wrapperKind === 'private_key' &&
        row.wrapperSha256 === wrappedPrivateKeySha256,
    ) ||
    wrapperHistoryRows.some(
      (row) =>
        !wrapperHistoryEntries.some(
          (entry) =>
            entry.kind === row.wrapperKind &&
            entry.sha256 === row.wrapperSha256,
        ),
    )
  ) {
    throw new Error('account key initialization did not commit one generation')
  }

  return {
    status: 'initialized',
    securityStamp: input.expectedSecurityStamp,
    revisionDate: input.nextRevisionDate,
    auditEventId: input.auditEventId,
  }
}

export async function changeAccountKdf(
  database: CredentialRepositoryDatabase,
  input: ChangeAccountKdfInput,
): Promise<ChangeAccountKdfResult> {
  const wrapperHistory = await prepareCredentialWrapperHistoryMutation(
    database,
    input,
  )
  if (!wrapperHistory) {
    return { status: 'conflict' }
  }
  const result = await commitCredentialGenerationMutation(
    database,
    input,
    database
      .prepare(
        `
          UPDATE users
          SET
            master_password_hash = ?,
            user_key = ?,
            kdf_algorithm = ?,
            kdf_iterations = ?,
            kdf_memory = ?,
            kdf_parallelism = ?,
            security_stamp = ?,
            revision_date = ?,
            updated_at = ?
          WHERE id = ?
            AND disabled_at IS NULL
            AND master_password_hash = ?
            AND email_normalized = ?
            AND kdf_algorithm = ?
            AND kdf_iterations = ?
            AND kdf_memory IS ?
            AND kdf_parallelism IS ?
            AND security_stamp = ?
            AND revision_date = ?
            AND user_key IS ?
            AND private_key IS ?
            AND NOT EXISTS (
              SELECT 1
              FROM user_key_rotation_wrapper_history history
              WHERE history.user_id = users.id
                AND history.wrapper_sha256 = ?
            )
          RETURNING id
        `,
      )
      .bind(
        input.nextMasterPasswordHash,
        input.nextUserKey,
        input.nextKdfAlgorithm,
        input.nextKdfIterations,
        input.nextKdfMemory,
        input.nextKdfParallelism,
        input.nextSecurityStamp,
        input.nextRevisionDate,
        input.nextRevisionDate,
        input.userId,
        input.expectedMasterPasswordHash,
        input.expectedEmailNormalized,
        input.expectedKdfAlgorithm,
        input.expectedKdfIterations,
        input.expectedKdfMemory,
        input.expectedKdfParallelism,
        input.expectedSecurityStamp,
        input.expectedRevisionDate,
        input.expectedUserKey,
        input.expectedPrivateKey,
        wrapperHistory.nextWrapperSha256,
      ),
    wrapperHistory,
  )

  return result ? { status: 'changed', ...result } : { status: 'conflict' }
}

export async function changeAccountMasterPassword(
  database: CredentialRepositoryDatabase,
  input: ChangeAccountMasterPasswordInput,
): Promise<ChangeAccountMasterPasswordResult> {
  const wrapperHistory = await prepareCredentialWrapperHistoryMutation(
    database,
    input,
  )
  if (!wrapperHistory) {
    return { status: 'conflict' }
  }
  const result = await commitCredentialGenerationMutation(
    database,
    input,
    database
      .prepare(
        `
          UPDATE users
          SET
            master_password_hash = ?,
            user_key = ?,
            security_stamp = ?,
            revision_date = ?,
            updated_at = ?
          WHERE id = ?
            AND disabled_at IS NULL
            AND master_password_hash = ?
            AND email_normalized = ?
            AND kdf_algorithm = ?
            AND kdf_iterations = ?
            AND kdf_memory IS ?
            AND kdf_parallelism IS ?
            AND security_stamp = ?
            AND revision_date = ?
            AND user_key IS ?
            AND private_key IS ?
            AND NOT EXISTS (
              SELECT 1
              FROM user_key_rotation_wrapper_history history
              WHERE history.user_id = users.id
                AND history.wrapper_sha256 = ?
            )
          RETURNING id
        `,
      )
      .bind(
        input.nextMasterPasswordHash,
        input.nextUserKey,
        input.nextSecurityStamp,
        input.nextRevisionDate,
        input.nextRevisionDate,
        input.userId,
        input.expectedMasterPasswordHash,
        input.expectedEmailNormalized,
        input.expectedKdfAlgorithm,
        input.expectedKdfIterations,
        input.expectedKdfMemory,
        input.expectedKdfParallelism,
        input.expectedSecurityStamp,
        input.expectedRevisionDate,
        input.expectedUserKey,
        input.expectedPrivateKey,
        wrapperHistory.nextWrapperSha256,
      ),
    wrapperHistory,
  )

  return result ? { status: 'changed', ...result } : { status: 'conflict' }
}

export async function rotateAccountSecurityStamp(
  database: CredentialRepositoryDatabase,
  input: RotateAccountSecurityStampInput,
): Promise<RotateAccountSecurityStampResult> {
  const result = await commitCredentialGenerationMutation(
    database,
    input,
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
          RETURNING id
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
  )

  return result ? { status: 'rotated', ...result } : { status: 'conflict' }
}

async function commitCredentialGenerationMutation(
  database: CredentialRepositoryDatabase,
  input: RotateAccountSecurityStampInput,
  userStatement: D1PreparedStatement,
  wrapperHistory?: CredentialWrapperHistoryMutation,
): Promise<CredentialGenerationMutationResult | null> {
  const event = input.auditEvent
  const results = await database.batch([
    userStatement,
    ...(wrapperHistory ? [wrapperHistory.statement] : []),
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

  const expectedResultCount = wrapperHistory ? 6 : 5
  if (results.length !== expectedResultCount) {
    throw new Error(
      'credential rotation batch returned an invalid result count',
    )
  }

  const [userResult, ...downstreamResults] = results
  const wrapperHistoryResult = wrapperHistory
    ? downstreamResults.shift()
    : undefined
  const [deviceResult, refreshResult, authRequestResult, auditResult] =
    downstreamResults
  const updatedUsers = (userResult?.results ?? []) as UpdatedUserRow[]
  const userChanges = updatedUsers.length
  const wrapperHistoryChanges = wrapperHistoryResult?.meta.changes ?? 0
  const deviceChanges = deviceResult?.meta.changes ?? 0
  const refreshChanges = refreshResult?.meta.changes ?? 0
  const authRequestChanges = authRequestResult?.meta.changes ?? 0
  const auditChanges = auditResult?.meta.changes ?? 0

  if (userChanges === 0) {
    if (
      wrapperHistoryChanges !== 0 ||
      deviceChanges !== 0 ||
      refreshChanges !== 0 ||
      authRequestChanges !== 0 ||
      auditChanges !== 0
    ) {
      throw new Error('credential rotation guard invariant was violated')
    }
    return null
  }
  if (
    !userResult?.success ||
    userChanges !== 1 ||
    updatedUsers[0]?.id !== input.userId ||
    !credentialWrapperHistoryCommitted(wrapperHistory, wrapperHistoryResult) ||
    !deviceResult?.success ||
    !refreshResult?.success ||
    !authRequestResult?.success ||
    !auditResult?.success ||
    auditChanges !== 1
  ) {
    throw new Error('credential rotation batch did not commit one generation')
  }

  return {
    securityStamp: input.nextSecurityStamp,
    revisionDate: input.nextRevisionDate,
    revokedDeviceCount: deviceChanges,
    revokedRefreshTokenCount: refreshChanges,
    invalidatedAuthRequestCount: authRequestChanges,
    auditEventId: input.auditEventId,
  }
}

async function prepareCredentialWrapperHistoryMutation(
  database: CredentialRepositoryDatabase,
  input: ChangeAccountMasterPasswordInput,
): Promise<CredentialWrapperHistoryMutation | null> {
  if (input.expectedUserKey === null && input.expectedPrivateKey !== null) {
    return null
  }
  const entries: Array<{
    kind: CredentialWrapperHistoryRow['wrapperKind']
    sha256: string
  }> = []
  if (input.expectedUserKey !== null) {
    entries.push({
      kind: 'user_key',
      sha256: await fingerprintCredentialWrapper(input.expectedUserKey),
    })
  }
  if (input.expectedPrivateKey !== null) {
    entries.push({
      kind: 'private_key',
      sha256: await fingerprintCredentialWrapper(input.expectedPrivateKey),
    })
  }
  const nextWrapperSha256 = await fingerprintCredentialWrapper(
    input.nextUserKey,
  )
  const currentWrapperSha256 = new Set(entries.map((entry) => entry.sha256))
  if (
    currentWrapperSha256.size !== entries.length ||
    currentWrapperSha256.has(nextWrapperSha256)
  ) {
    return null
  }
  entries.push({ kind: 'user_key', sha256: nextWrapperSha256 })

  return {
    statement: database
      .prepare(insertCredentialWrapperHistorySql)
      .bind(
        JSON.stringify(entries),
        input.userId,
        input.nextRevisionDate,
        input.userId,
        input.nextSecurityStamp,
        input.nextRevisionDate,
      ),
    allowedWrapperSha256: new Set(entries.map((entry) => entry.sha256)),
    nextWrapperSha256,
  }
}

function credentialWrapperHistoryCommitted(
  mutation: CredentialWrapperHistoryMutation | undefined,
  result: D1Result | undefined,
): boolean {
  if (!mutation) {
    return result === undefined
  }
  if (!result?.success || (result.meta.changes ?? 0) < 1) {
    return false
  }
  const inserted = (result.results ?? []) as CredentialWrapperHistoryRow[]
  return (
    inserted.length === (result.meta.changes ?? 0) &&
    new Set(inserted.map((row) => row.wrapperSha256)).size ===
      inserted.length &&
    inserted.every(
      (row) =>
        ['user_key', 'private_key'].includes(row.wrapperKind) &&
        mutation.allowedWrapperSha256.has(row.wrapperSha256),
    ) &&
    inserted.some((row) => row.wrapperSha256 === mutation.nextWrapperSha256)
  )
}
