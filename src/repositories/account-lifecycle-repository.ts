import type { AccountLifecycleTokenPurpose } from '../domain/account-lifecycle'
import { fingerprintCredentialWrapper } from '../domain/account-credentials'
import type { AuditEvent } from '../domain/audit'
import { insertCredentialWrapperHistorySql } from './credential-wrapper-history-sql'

type AccountLifecycleDatabase = Pick<D1Database, 'batch' | 'prepare'>
const accountPurgeR2BatchSize = 1_000
const lastConfirmedOwnerMembershipSql = `
  SELECT 1
  FROM organization_users AS current_owner
  WHERE current_owner.user_id = ?
    AND current_owner.status = 2
    AND current_owner.type = 0
    AND NOT EXISTS (
      SELECT 1
      FROM organization_users AS other_owner
      JOIN users AS other_user ON other_user.id = other_owner.user_id
      WHERE other_owner.organization_id = current_owner.organization_id
        AND other_owner.status = 2
        AND other_owner.type = 0
        AND other_owner.user_id IS NOT NULL
        AND other_owner.user_id <> ?
        AND other_user.disabled_at IS NULL
    )
`

export type ReserveAccountLifecycleTokenInput = {
  id: string
  userId: string
  purpose: AccountLifecycleTokenPurpose
  tokenDigest: string
  targetEmailNormalized: string | null
  expectedCredentialGeneration: string
  now: string
  expiresAt: string
}

export type AccountLifecycleMutationResult = {
  status: 'updated' | 'unavailable'
}

export type ChangeAccountEmailInput = {
  userId: string
  expectedEmailNormalized: string
  expectedMasterPasswordHash: string
  expectedUserKey: string
  expectedSecurityStamp: string
  expectedRevisionDate: string
  tokenDigest: string
  tokenCredentialGeneration: string
  nextEmail: string
  nextEmailNormalized: string
  nextMasterPasswordHash: string
  nextUserKey: string
  nextSecurityStamp: string
  nextRevisionDate: string
  auditEventId: string
  auditEvent: AuditEvent
}

export type ChangeAccountEmailResult =
  | {
      status: 'changed'
      revokedDeviceCount: number
      revokedRefreshTokenCount: number
      invalidatedAuthRequestCount: number
      updatedOrganizationMembershipCount: number
    }
  | { status: 'conflict' }

export type VerifyAccountEmailInput = {
  userId: string
  credentialGeneration: string
  tokenDigest: string
  now: string
  auditEventId: string
  auditEvent: AuditEvent
}

export type BeginRecoverableAccountDeletionInput = {
  userId: string
  expectedMasterPasswordHash: string
  expectedSecurityStamp: string
  expectedRevisionDate: string
  tokenDigest: string | null
  lifecycleGeneration: string
  nextSecurityStamp: string
  now: string
  recoverUntil: string
  auditEventId: string
  auditEvent: AuditEvent
}

export type BeginRecoverableAccountDeletionResult =
  | {
      status: 'recoverable'
      lifecycleGeneration: string
      recoverUntil: string
      revokedDeviceCount: number
      revokedRefreshTokenCount: number
      invalidatedAuthRequestCount: number
    }
  | { status: 'last_owner' | 'conflict' }

export type AccountDeletionPlan = {
  status:
    'recoverable' | 'purge_ready' | 'purging_r2' | 'tombstoned' | 'recovered'
  lifecycleGeneration: string
  requestedAt: string
  recoverUntil: string
  recoveryAllowed: boolean
  purgeAllowed: boolean
  personalCipherCount: number
  organizationCipherCount: number
  personalAttachmentCount: number
  personalR2DeletedCount: number
}

export async function reserveAccountLifecycleToken(
  database: AccountLifecycleDatabase,
  input: ReserveAccountLifecycleTokenInput,
): Promise<{ status: 'reserved' | 'unavailable' }> {
  const eligibilitySql = `
    SELECT 1
    FROM users
    WHERE id = ?
      AND security_stamp = ?
      AND disabled_at IS NULL
      AND (
        ? != 'email_change'
        OR (
          ? IS NOT NULL
          AND email_normalized <> ?
          AND NOT EXISTS (
            SELECT 1
            FROM users AS target_user
            WHERE target_user.email_normalized = ?
              AND target_user.id <> ?
          )
        )
      )
  `
  const eligibilityBindings = [
    input.userId,
    input.expectedCredentialGeneration,
    input.purpose,
    input.targetEmailNormalized,
    input.targetEmailNormalized,
    input.targetEmailNormalized,
    input.userId,
  ] as const

  const results = await database.batch([
    database
      .prepare(
        `
          UPDATE account_lifecycle_tokens
          SET superseded_at = ?, updated_at = ?
          WHERE user_id = ?
            AND purpose = ?
            AND consumed_at IS NULL
            AND superseded_at IS NULL
            AND EXISTS (${eligibilitySql})
        `,
      )
      .bind(
        input.now,
        input.now,
        input.userId,
        input.purpose,
        ...eligibilityBindings,
      ),
    database
      .prepare(
        `
          INSERT INTO account_lifecycle_tokens (
            id,
            user_id,
            purpose,
            token_digest,
            target_email_normalized,
            credential_generation,
            delivery_state,
            expires_at,
            created_at,
            updated_at
          )
          SELECT ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?
          FROM users
          WHERE id = ?
            AND security_stamp = ?
            AND disabled_at IS NULL
            AND (
              ? != 'email_change'
              OR (
                ? IS NOT NULL
                AND email_normalized <> ?
                AND NOT EXISTS (
                  SELECT 1
                  FROM users AS target_user
                  WHERE target_user.email_normalized = ?
                    AND target_user.id <> ?
                )
              )
            )
        `,
      )
      .bind(
        input.id,
        input.userId,
        input.purpose,
        input.tokenDigest,
        input.targetEmailNormalized,
        input.expectedCredentialGeneration,
        input.expiresAt,
        input.now,
        input.now,
        ...eligibilityBindings,
      ),
  ])

  if (results.length !== 2) {
    throw new Error('account lifecycle token batch returned an invalid count')
  }
  const supersededCount = results[0]?.meta.changes ?? 0
  const insertedCount = results[1]?.meta.changes ?? 0
  if (supersededCount > 1 || insertedCount > 1) {
    throw new Error(
      'account lifecycle token reservation invariant was violated',
    )
  }

  return insertedCount === 1
    ? { status: 'reserved' }
    : { status: 'unavailable' }
}

export async function markAccountLifecycleTokenDeliveryAccepted(
  database: Pick<D1Database, 'prepare'>,
  tokenId: string,
  now: string,
): Promise<AccountLifecycleMutationResult> {
  const result = await database
    .prepare(
      `
        UPDATE account_lifecycle_tokens
        SET delivery_state = 'accepted', updated_at = ?
        WHERE id = ?
          AND delivery_state = 'pending'
          AND consumed_at IS NULL
          AND superseded_at IS NULL
      `,
    )
    .bind(now, tokenId)
    .run()

  return result.meta.changes === 1
    ? { status: 'updated' }
    : { status: 'unavailable' }
}

export async function markAccountLifecycleTokenDeliveryFailed(
  database: Pick<D1Database, 'prepare'>,
  tokenId: string,
  now: string,
): Promise<AccountLifecycleMutationResult> {
  const result = await database
    .prepare(
      `
        UPDATE account_lifecycle_tokens
        SET
          delivery_state = 'failed',
          superseded_at = ?,
          updated_at = ?
        WHERE id = ?
          AND delivery_state = 'pending'
          AND consumed_at IS NULL
          AND superseded_at IS NULL
      `,
    )
    .bind(now, now, tokenId)
    .run()

  return result.meta.changes === 1
    ? { status: 'updated' }
    : { status: 'unavailable' }
}

export async function changeAccountEmail(
  database: AccountLifecycleDatabase,
  input: ChangeAccountEmailInput,
): Promise<ChangeAccountEmailResult> {
  const [currentWrapperSha256, nextWrapperSha256] = await Promise.all([
    fingerprintCredentialWrapper(input.expectedUserKey),
    fingerprintCredentialWrapper(input.nextUserKey),
  ])
  if (currentWrapperSha256 === nextWrapperSha256) {
    return { status: 'conflict' }
  }
  const event = input.auditEvent
  const committedGenerationGuard = `
    SELECT 1
    FROM users
    WHERE id = ?
      AND email_normalized = ?
      AND security_stamp = ?
      AND revision_date = ?
  `
  const committedGenerationBindings = [
    input.userId,
    input.nextEmailNormalized,
    input.nextSecurityStamp,
    input.nextRevisionDate,
  ] as const
  const results = await database.batch([
    database
      .prepare(
        `
          UPDATE users
          SET
            email = ?,
            email_normalized = ?,
            email_verified_at = ?,
            master_password_hash = ?,
            user_key = ?,
            security_stamp = ?,
            revision_date = ?,
            updated_at = ?
          WHERE id = ?
            AND email_normalized = ?
            AND master_password_hash = ?
            AND user_key = ?
            AND security_stamp = ?
            AND revision_date = ?
            AND disabled_at IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM users AS target_user
              WHERE target_user.email_normalized = ?
                AND target_user.id <> ?
            )
            AND NOT EXISTS (
              SELECT 1
              FROM organization_users AS current_membership
              JOIN organization_users AS target_membership
                ON target_membership.organization_id = current_membership.organization_id
               AND lower(target_membership.email) = ?
               AND target_membership.id <> current_membership.id
              WHERE current_membership.user_id = users.id
            )
            AND NOT EXISTS (
              SELECT 1
              FROM user_key_rotation_wrapper_history
              WHERE user_id = ? AND wrapper_sha256 = ?
            )
            AND EXISTS (
              SELECT 1
              FROM account_lifecycle_tokens AS lifecycle_token
              WHERE lifecycle_token.user_id = users.id
                AND lifecycle_token.purpose = 'email_change'
                AND lifecycle_token.token_digest = ?
                AND lifecycle_token.target_email_normalized = ?
                AND lifecycle_token.credential_generation = ?
                AND lifecycle_token.delivery_state = 'accepted'
                AND lifecycle_token.expires_at > ?
                AND lifecycle_token.consumed_at IS NULL
                AND lifecycle_token.superseded_at IS NULL
            )
          RETURNING id
        `,
      )
      .bind(
        input.nextEmail,
        input.nextEmailNormalized,
        input.nextRevisionDate,
        input.nextMasterPasswordHash,
        input.nextUserKey,
        input.nextSecurityStamp,
        input.nextRevisionDate,
        input.nextRevisionDate,
        input.userId,
        input.expectedEmailNormalized,
        input.expectedMasterPasswordHash,
        input.expectedUserKey,
        input.expectedSecurityStamp,
        input.expectedRevisionDate,
        input.nextEmailNormalized,
        input.userId,
        input.nextEmailNormalized,
        input.userId,
        nextWrapperSha256,
        input.tokenDigest,
        input.nextEmailNormalized,
        input.tokenCredentialGeneration,
        input.nextRevisionDate,
      ),
    database.prepare(insertCredentialWrapperHistorySql).bind(
      JSON.stringify([
        { kind: 'user_key', sha256: currentWrapperSha256 },
        { kind: 'user_key', sha256: nextWrapperSha256 },
      ]),
      input.userId,
      input.nextRevisionDate,
      input.userId,
      input.nextSecurityStamp,
      input.nextRevisionDate,
    ),
    database
      .prepare(
        `
          UPDATE account_lifecycle_tokens
          SET consumed_at = ?, updated_at = ?
          WHERE user_id = ?
            AND purpose = 'email_change'
            AND token_digest = ?
            AND target_email_normalized = ?
            AND credential_generation = ?
            AND delivery_state = 'accepted'
            AND expires_at > ?
            AND consumed_at IS NULL
            AND superseded_at IS NULL
            AND EXISTS (${committedGenerationGuard})
        `,
      )
      .bind(
        input.nextRevisionDate,
        input.nextRevisionDate,
        input.userId,
        input.tokenDigest,
        input.nextEmailNormalized,
        input.tokenCredentialGeneration,
        input.nextRevisionDate,
        ...committedGenerationBindings,
      ),
    database
      .prepare(
        `
          UPDATE organization_users
          SET email = ?, updated_at = ?
          WHERE user_id = ?
            AND EXISTS (${committedGenerationGuard})
        `,
      )
      .bind(
        input.nextEmail,
        input.nextRevisionDate,
        input.userId,
        ...committedGenerationBindings,
      ),
    database
      .prepare(
        `
          UPDATE devices
          SET revoked_at = ?, updated_at = ?
          WHERE user_id = ?
            AND revoked_at IS NULL
            AND EXISTS (${committedGenerationGuard})
        `,
      )
      .bind(
        input.nextRevisionDate,
        input.nextRevisionDate,
        input.userId,
        ...committedGenerationBindings,
      ),
    database
      .prepare(
        `
          UPDATE refresh_tokens
          SET revoked_at = ?
          WHERE user_id = ?
            AND revoked_at IS NULL
            AND EXISTS (${committedGenerationGuard})
        `,
      )
      .bind(
        input.nextRevisionDate,
        input.userId,
        ...committedGenerationBindings,
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
            AND EXISTS (${committedGenerationGuard})
        `,
      )
      .bind(
        input.nextRevisionDate,
        input.userId,
        ...committedGenerationBindings,
      ),
    database
      .prepare(
        `
          INSERT INTO audit_events (
            id, schema_version, name, outcome, request_id, occurred_at,
            actor_user_id, actor_device_identifier, target_type, target_id,
            context_json
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (${committedGenerationGuard})
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
        ...committedGenerationBindings,
      ),
  ])

  if (results.length !== 8) {
    throw new Error('account email change batch returned an invalid count')
  }
  const [
    userResult,
    wrapperResult,
    tokenResult,
    membershipResult,
    deviceResult,
    refreshResult,
    authRequestResult,
    auditResult,
  ] = results
  const users = (userResult?.results ?? []) as Array<{ id: string }>
  const wrappers = (wrapperResult?.results ?? []) as Array<{
    wrapperKind: string
    wrapperSha256: string
  }>
  const downstreamChanges = results
    .slice(1)
    .map((result) => result.meta.changes ?? 0)
  if (users.length === 0) {
    if (downstreamChanges.some((changes) => changes !== 0)) {
      throw new Error('account email change guard invariant was violated')
    }
    return { status: 'conflict' }
  }
  const expectedWrappers = new Set([currentWrapperSha256, nextWrapperSha256])
  const insertedWrapperDigests = wrappers.map((row) => row.wrapperSha256)
  const wrapperChanges = wrapperResult?.meta.changes ?? 0
  if (
    users.length !== 1 ||
    users[0]?.id !== input.userId ||
    wrapperChanges < 1 ||
    wrapperChanges > 2 ||
    wrappers.length !== wrapperChanges ||
    new Set(insertedWrapperDigests).size !== insertedWrapperDigests.length ||
    wrappers.some(
      (row) =>
        row.wrapperKind !== 'user_key' ||
        !expectedWrappers.has(row.wrapperSha256),
    ) ||
    !insertedWrapperDigests.includes(nextWrapperSha256) ||
    (tokenResult?.meta.changes ?? 0) !== 1 ||
    (auditResult?.meta.changes ?? 0) !== 1
  ) {
    throw new Error('account email change did not commit one generation')
  }

  return {
    status: 'changed',
    revokedDeviceCount: deviceResult?.meta.changes ?? 0,
    revokedRefreshTokenCount: refreshResult?.meta.changes ?? 0,
    invalidatedAuthRequestCount: authRequestResult?.meta.changes ?? 0,
    updatedOrganizationMembershipCount: membershipResult?.meta.changes ?? 0,
  }
}

export async function verifyAccountEmail(
  database: AccountLifecycleDatabase,
  input: VerifyAccountEmailInput,
): Promise<{ status: 'verified' | 'conflict' }> {
  const event = input.auditEvent
  const verifiedGuard = `
    SELECT 1
    FROM users
    WHERE id = ?
      AND security_stamp = ?
      AND email_verified_at = ?
      AND disabled_at IS NULL
  `
  const verifiedBindings = [
    input.userId,
    input.credentialGeneration,
    input.now,
  ] as const
  const results = await database.batch([
    database
      .prepare(
        `
          UPDATE users
          SET email_verified_at = ?, updated_at = ?
          WHERE id = ?
            AND security_stamp = ?
            AND disabled_at IS NULL
            AND EXISTS (
              SELECT 1
              FROM account_lifecycle_tokens AS lifecycle_token
              WHERE lifecycle_token.user_id = users.id
                AND lifecycle_token.purpose = 'email_verify'
                AND lifecycle_token.token_digest = ?
                AND lifecycle_token.credential_generation = ?
                AND lifecycle_token.delivery_state = 'accepted'
                AND lifecycle_token.expires_at > ?
                AND lifecycle_token.consumed_at IS NULL
                AND lifecycle_token.superseded_at IS NULL
            )
          RETURNING id
        `,
      )
      .bind(
        input.now,
        input.now,
        input.userId,
        input.credentialGeneration,
        input.tokenDigest,
        input.credentialGeneration,
        input.now,
      ),
    database
      .prepare(
        `
          UPDATE account_lifecycle_tokens
          SET consumed_at = ?, updated_at = ?
          WHERE user_id = ?
            AND purpose = 'email_verify'
            AND token_digest = ?
            AND credential_generation = ?
            AND delivery_state = 'accepted'
            AND expires_at > ?
            AND consumed_at IS NULL
            AND superseded_at IS NULL
            AND EXISTS (${verifiedGuard})
        `,
      )
      .bind(
        input.now,
        input.now,
        input.userId,
        input.tokenDigest,
        input.credentialGeneration,
        input.now,
        ...verifiedBindings,
      ),
    database
      .prepare(
        `
          INSERT INTO audit_events (
            id, schema_version, name, outcome, request_id, occurred_at,
            actor_user_id, actor_device_identifier, target_type, target_id,
            context_json
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (${verifiedGuard})
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
        ...verifiedBindings,
      ),
  ])

  if (results.length !== 3) {
    throw new Error(
      'account email verification batch returned an invalid count',
    )
  }
  const [userResult, tokenResult, auditResult] = results
  const users = (userResult?.results ?? []) as Array<{ id: string }>
  if (users.length === 0) {
    if (
      (tokenResult?.meta.changes ?? 0) !== 0 ||
      (auditResult?.meta.changes ?? 0) !== 0
    ) {
      throw new Error('account email verification guard invariant was violated')
    }
    return { status: 'conflict' }
  }
  if (
    users.length !== 1 ||
    users[0]?.id !== input.userId ||
    (tokenResult?.meta.changes ?? 0) !== 1 ||
    (auditResult?.meta.changes ?? 0) !== 1
  ) {
    throw new Error('account email verification did not commit once')
  }
  return { status: 'verified' }
}

export async function beginRecoverableAccountDeletion(
  database: AccountLifecycleDatabase,
  input: BeginRecoverableAccountDeletionInput,
): Promise<BeginRecoverableAccountDeletionResult> {
  const event = input.auditEvent
  const lastOwnerCountSql = `
    SELECT COUNT(*) as lastOwnerCount
    FROM (${lastConfirmedOwnerMembershipSql}) AS last_owner_memberships
  `
  const disabledGenerationGuard = `
    SELECT 1
    FROM users
    WHERE id = ?
      AND disabled_at = ?
      AND security_stamp = ?
      AND revision_date = ?
  `
  const disabledGenerationBindings = [
    input.userId,
    input.now,
    input.nextSecurityStamp,
    input.now,
  ] as const
  const results = await database.batch([
    database.prepare(lastOwnerCountSql).bind(input.userId, input.userId),
    database
      .prepare(
        `
          UPDATE users
          SET
            disabled_at = ?,
            security_stamp = ?,
            revision_date = ?,
            updated_at = ?
          WHERE id = ?
            AND disabled_at IS NULL
            AND master_password_hash = ?
            AND security_stamp = ?
            AND revision_date = ?
            AND NOT EXISTS (
              SELECT 1
              FROM account_deletions
              WHERE user_id = users.id AND state <> 'recovered'
            )
            AND NOT EXISTS (${lastConfirmedOwnerMembershipSql})
            AND (
              ? IS NULL
              OR EXISTS (
                SELECT 1
                FROM account_lifecycle_tokens AS deletion_token
                WHERE deletion_token.user_id = users.id
                  AND deletion_token.purpose = 'account_delete'
                  AND deletion_token.token_digest = ?
                  AND deletion_token.credential_generation = ?
                  AND deletion_token.delivery_state = 'accepted'
                  AND deletion_token.expires_at > ?
                  AND deletion_token.consumed_at IS NULL
                  AND deletion_token.superseded_at IS NULL
              )
            )
          RETURNING id
        `,
      )
      .bind(
        input.now,
        input.nextSecurityStamp,
        input.now,
        input.now,
        input.userId,
        input.expectedMasterPasswordHash,
        input.expectedSecurityStamp,
        input.expectedRevisionDate,
        input.userId,
        input.userId,
        input.tokenDigest,
        input.tokenDigest,
        input.expectedSecurityStamp,
        input.now,
      ),
    database
      .prepare(
        `
          INSERT INTO account_deletions (
            user_id,
            lifecycle_generation,
            state,
            requested_at,
            recover_until,
            updated_at
          )
          SELECT ?, ?, 'recoverable', ?, ?, ?
          FROM users
          WHERE id = ?
            AND disabled_at = ?
            AND security_stamp = ?
            AND revision_date = ?
          ON CONFLICT(user_id) DO UPDATE SET
            lifecycle_generation = excluded.lifecycle_generation,
            state = 'recoverable',
            requested_at = excluded.requested_at,
            recover_until = excluded.recover_until,
            purge_started_at = NULL,
            purge_operation_id = NULL,
            tombstoned_at = NULL,
            recovered_at = NULL,
            personal_r2_expected_count = 0,
            personal_r2_deleted_count = 0,
            last_error_code = NULL,
            updated_at = excluded.updated_at
          WHERE account_deletions.state = 'recovered'
        `,
      )
      .bind(
        input.userId,
        input.lifecycleGeneration,
        input.now,
        input.recoverUntil,
        input.now,
        ...disabledGenerationBindings,
      ),
    database
      .prepare(
        `
          UPDATE account_lifecycle_tokens
          SET
            consumed_at = CASE
              WHEN ? IS NOT NULL
                AND purpose = 'account_delete'
                AND token_digest = ?
              THEN ?
              ELSE consumed_at
            END,
            superseded_at = CASE
              WHEN ? IS NOT NULL
                AND purpose = 'account_delete'
                AND token_digest = ?
              THEN superseded_at
              ELSE ?
            END,
            updated_at = ?
          WHERE user_id = ?
            AND consumed_at IS NULL
            AND superseded_at IS NULL
            AND EXISTS (${disabledGenerationGuard})
        `,
      )
      .bind(
        input.tokenDigest,
        input.tokenDigest,
        input.now,
        input.tokenDigest,
        input.tokenDigest,
        input.now,
        input.now,
        input.userId,
        ...disabledGenerationBindings,
      ),
    database
      .prepare(
        `
          UPDATE devices
          SET revoked_at = ?, updated_at = ?
          WHERE user_id = ?
            AND revoked_at IS NULL
            AND EXISTS (${disabledGenerationGuard})
        `,
      )
      .bind(input.now, input.now, input.userId, ...disabledGenerationBindings),
    database
      .prepare(
        `
          UPDATE refresh_tokens
          SET revoked_at = ?
          WHERE user_id = ?
            AND revoked_at IS NULL
            AND EXISTS (${disabledGenerationGuard})
        `,
      )
      .bind(input.now, input.userId, ...disabledGenerationBindings),
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
            AND EXISTS (${disabledGenerationGuard})
        `,
      )
      .bind(input.now, input.userId, ...disabledGenerationBindings),
    database
      .prepare(
        `
          INSERT INTO audit_events (
            id, schema_version, name, outcome, request_id, occurred_at,
            actor_user_id, actor_device_identifier, target_type, target_id,
            context_json
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (${disabledGenerationGuard})
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
        ...disabledGenerationBindings,
      ),
  ])

  if (results.length !== 8) {
    throw new Error('account deletion batch returned an invalid count')
  }
  const [
    ownerResult,
    userResult,
    deletionResult,
    ,
    deviceResult,
    refreshResult,
    authRequestResult,
    auditResult,
  ] = results
  const ownerRows = (ownerResult?.results ?? []) as Array<{
    lastOwnerCount: number
  }>
  const users = (userResult?.results ?? []) as Array<{ id: string }>
  if (users.length === 0) {
    if (results.slice(2).some((result) => (result.meta.changes ?? 0) !== 0)) {
      throw new Error('account deletion guard invariant was violated')
    }
    return (ownerRows[0]?.lastOwnerCount ?? 0) > 0
      ? { status: 'last_owner' }
      : { status: 'conflict' }
  }
  if (
    users.length !== 1 ||
    users[0]?.id !== input.userId ||
    (deletionResult?.meta.changes ?? 0) !== 1 ||
    (auditResult?.meta.changes ?? 0) !== 1
  ) {
    throw new Error('account deletion did not enter recoverable state')
  }
  return {
    status: 'recoverable',
    lifecycleGeneration: input.lifecycleGeneration,
    recoverUntil: input.recoverUntil,
    revokedDeviceCount: deviceResult?.meta.changes ?? 0,
    revokedRefreshTokenCount: refreshResult?.meta.changes ?? 0,
    invalidatedAuthRequestCount: authRequestResult?.meta.changes ?? 0,
  }
}

export async function planAccountDeletion(
  database: Pick<D1Database, 'prepare'>,
  input: { userId: string; lifecycleGeneration: string; now: string },
): Promise<AccountDeletionPlan | { status: 'not_found' }> {
  const row = await database
    .prepare(
      `
        SELECT
          deletion.state,
          deletion.lifecycle_generation as lifecycleGeneration,
          deletion.requested_at as requestedAt,
          deletion.recover_until as recoverUntil,
          deletion.personal_r2_deleted_count as personalR2DeletedCount,
          (
            SELECT COUNT(*) FROM ciphers
            WHERE user_id = deletion.user_id AND organization_id IS NULL
          ) as personalCipherCount,
          (
            SELECT COUNT(*) FROM ciphers
            WHERE user_id = deletion.user_id AND organization_id IS NOT NULL
          ) as organizationCipherCount,
          (
            SELECT COUNT(*)
            FROM cipher_attachments AS attachment
            JOIN ciphers AS cipher ON cipher.id = attachment.cipher_id
            WHERE cipher.user_id = deletion.user_id
              AND cipher.organization_id IS NULL
          ) as personalAttachmentCount,
          EXISTS (${lastConfirmedOwnerMembershipSql}) as isLastConfirmedOwner
        FROM account_deletions AS deletion
        JOIN users AS account ON account.id = deletion.user_id
        WHERE deletion.user_id = ?
          AND deletion.lifecycle_generation = ?
        LIMIT 1
      `,
    )
    .bind(input.userId, input.userId, input.userId, input.lifecycleGeneration)
    .first<{
      state: AccountDeletionPlan['status']
      lifecycleGeneration: string
      requestedAt: string
      recoverUntil: string
      personalR2DeletedCount: number
      personalCipherCount: number
      organizationCipherCount: number
      personalAttachmentCount: number
      isLastConfirmedOwner: number
    }>()
  if (!row) return { status: 'not_found' }

  const now = Date.parse(input.now)
  const cutoff = Date.parse(row.recoverUntil)
  if (!Number.isFinite(now) || !Number.isFinite(cutoff)) {
    throw new Error('account deletion plan timestamps are invalid')
  }
  return {
    status: row.state,
    lifecycleGeneration: row.lifecycleGeneration,
    requestedAt: row.requestedAt,
    recoverUntil: row.recoverUntil,
    personalR2DeletedCount: row.personalR2DeletedCount,
    personalCipherCount: row.personalCipherCount,
    organizationCipherCount: row.organizationCipherCount,
    personalAttachmentCount: row.personalAttachmentCount,
    recoveryAllowed: row.state === 'recoverable' && now < cutoff,
    purgeAllowed:
      (row.state === 'recoverable' ||
        row.state === 'purge_ready' ||
        row.state === 'purging_r2') &&
      now >= cutoff &&
      row.isLastConfirmedOwner === 0,
  }
}

export async function recoverAccountDeletion(
  database: AccountLifecycleDatabase,
  input: {
    userId: string
    lifecycleGeneration: string
    expectedDisabledSecurityStamp: string
    now: string
    nextSecurityStamp: string
    auditEventId: string
    auditEvent: AuditEvent
  },
): Promise<{ status: 'recovered' | 'conflict' }> {
  const event = input.auditEvent
  const recoveredGuard = `
    SELECT 1 FROM users
    WHERE id = ?
      AND disabled_at IS NULL
      AND security_stamp = ?
      AND revision_date = ?
  `
  const recoveredBindings = [
    input.userId,
    input.nextSecurityStamp,
    input.now,
  ] as const
  const results = await database.batch([
    database
      .prepare(
        `
          UPDATE users
          SET
            disabled_at = NULL,
            security_stamp = ?,
            revision_date = ?,
            updated_at = ?
          WHERE id = ?
            AND disabled_at IS NOT NULL
            AND security_stamp = ?
            AND EXISTS (
              SELECT 1 FROM account_deletions
              WHERE user_id = users.id
                AND lifecycle_generation = ?
                AND state = 'recoverable'
                AND recover_until > ?
            )
          RETURNING id
        `,
      )
      .bind(
        input.nextSecurityStamp,
        input.now,
        input.now,
        input.userId,
        input.expectedDisabledSecurityStamp,
        input.lifecycleGeneration,
        input.now,
      ),
    database
      .prepare(
        `
          UPDATE account_deletions
          SET state = 'recovered', recovered_at = ?, updated_at = ?
          WHERE user_id = ?
            AND lifecycle_generation = ?
            AND state = 'recoverable'
            AND recover_until > ?
            AND EXISTS (${recoveredGuard})
        `,
      )
      .bind(
        input.now,
        input.now,
        input.userId,
        input.lifecycleGeneration,
        input.now,
        ...recoveredBindings,
      ),
    database
      .prepare(
        `
          INSERT INTO audit_events (
            id, schema_version, name, outcome, request_id, occurred_at,
            actor_user_id, actor_device_identifier, target_type, target_id,
            context_json
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (${recoveredGuard})
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
        ...recoveredBindings,
      ),
  ])
  if (results.length !== 3) {
    throw new Error('account recovery batch returned an invalid count')
  }
  const [userResult, deletionResult, auditResult] = results
  const users = (userResult?.results ?? []) as Array<{ id: string }>
  if (users.length === 0) {
    if (
      (deletionResult?.meta.changes ?? 0) !== 0 ||
      (auditResult?.meta.changes ?? 0) !== 0
    ) {
      throw new Error('account recovery guard invariant was violated')
    }
    return { status: 'conflict' }
  }
  if (
    users.length !== 1 ||
    users[0]?.id !== input.userId ||
    (deletionResult?.meta.changes ?? 0) !== 1 ||
    (auditResult?.meta.changes ?? 0) !== 1
  ) {
    throw new Error('account recovery did not commit once')
  }
  return { status: 'recovered' }
}

export async function markAccountPurgeReady(
  database: Pick<D1Database, 'prepare'>,
  input: {
    userId: string
    lifecycleGeneration: string
    now: string
    expectedPersonalAttachmentCount: number
  },
): Promise<{ status: 'purge_ready' | 'conflict' }> {
  const result = await database
    .prepare(
      `
        UPDATE account_deletions
        SET
          state = 'purge_ready',
          personal_r2_expected_count = ?,
          personal_r2_deleted_count = 0,
          last_error_code = NULL,
          updated_at = ?
        WHERE user_id = ?
          AND lifecycle_generation = ?
          AND state = 'recoverable'
          AND recover_until <= ?
          AND EXISTS (
            SELECT 1 FROM users
            WHERE id = account_deletions.user_id AND disabled_at IS NOT NULL
          )
          AND NOT EXISTS (${lastConfirmedOwnerMembershipSql})
          AND ? = (
            SELECT COUNT(*)
            FROM cipher_attachments AS attachment
            JOIN ciphers AS cipher ON cipher.id = attachment.cipher_id
            WHERE cipher.user_id = account_deletions.user_id
              AND cipher.organization_id IS NULL
          )
      `,
    )
    .bind(
      input.expectedPersonalAttachmentCount,
      input.now,
      input.userId,
      input.lifecycleGeneration,
      input.now,
      input.userId,
      input.userId,
      input.expectedPersonalAttachmentCount,
    )
    .run()
  return result.meta.changes === 1
    ? { status: 'purge_ready' }
    : { status: 'conflict' }
}

export async function startAccountPurge(
  database: AccountLifecycleDatabase,
  input: { userId: string; lifecycleGeneration: string; now: string },
): Promise<
  | {
      status: 'purging_r2'
      objectKeys: string[]
      deletedCount: number
      expectedCount: number
    }
  | { status: 'conflict' }
> {
  const results = await database.batch([
    database
      .prepare(
        `
          SELECT attachment.object_key as objectKey
          FROM cipher_attachments AS attachment
          JOIN ciphers AS cipher ON cipher.id = attachment.cipher_id
          WHERE cipher.user_id = ?
            AND cipher.organization_id IS NULL
            AND EXISTS (
              SELECT 1 FROM account_deletions
              WHERE user_id = cipher.user_id
                AND lifecycle_generation = ?
                AND state IN ('purge_ready', 'purging_r2')
            )
          ORDER BY attachment.object_key
          LIMIT ? OFFSET COALESCE((
            SELECT CASE
              WHEN state = 'purging_r2' THEN personal_r2_deleted_count
              ELSE 0
            END
            FROM account_deletions
            WHERE user_id = ? AND lifecycle_generation = ?
          ), 0)
        `,
      )
      .bind(
        input.userId,
        input.lifecycleGeneration,
        accountPurgeR2BatchSize,
        input.userId,
        input.lifecycleGeneration,
      ),
    database
      .prepare(
        `
          UPDATE account_deletions
          SET
            state = 'purging_r2',
            purge_started_at = COALESCE(purge_started_at, ?),
            personal_r2_deleted_count = CASE
              WHEN state = 'purge_ready' THEN 0
              ELSE personal_r2_deleted_count
            END,
            last_error_code = NULL,
            updated_at = ?
          WHERE user_id = ?
            AND lifecycle_generation = ?
            AND state IN ('purge_ready', 'purging_r2')
            AND EXISTS (
              SELECT 1 FROM users
              WHERE id = account_deletions.user_id AND disabled_at IS NOT NULL
            )
            AND NOT EXISTS (${lastConfirmedOwnerMembershipSql})
            AND personal_r2_expected_count = (
              SELECT COUNT(*)
              FROM cipher_attachments AS attachment
              JOIN ciphers AS cipher ON cipher.id = attachment.cipher_id
              WHERE cipher.user_id = account_deletions.user_id
                AND cipher.organization_id IS NULL
            )
          RETURNING
            personal_r2_deleted_count as deletedCount,
            personal_r2_expected_count as expectedCount
        `,
      )
      .bind(
        input.now,
        input.now,
        input.userId,
        input.lifecycleGeneration,
        input.userId,
        input.userId,
      ),
  ])
  if (results.length !== 2) {
    throw new Error('account purge start batch returned an invalid count')
  }
  const progressRows = (results[1]?.results ?? []) as Array<{
    deletedCount: number
    expectedCount: number
  }>
  const progressRow = progressRows[0]
  if (
    (results[1]?.meta.changes ?? 0) !== 1 ||
    progressRows.length !== 1 ||
    !progressRow ||
    !Number.isSafeInteger(progressRow.deletedCount) ||
    !Number.isSafeInteger(progressRow.expectedCount)
  ) {
    return { status: 'conflict' }
  }
  const objectKeys = (results[0]?.results ?? []) as Array<{ objectKey: string }>
  if (
    objectKeys.length > accountPurgeR2BatchSize ||
    objectKeys.some((row) => typeof row.objectKey !== 'string')
  ) {
    throw new Error('account purge object inventory is invalid')
  }
  return {
    status: 'purging_r2',
    objectKeys: objectKeys.map((row) => row.objectKey),
    deletedCount: progressRow.deletedCount,
    expectedCount: progressRow.expectedCount,
  }
}

export async function recordAccountPurgeProgress(
  database: Pick<D1Database, 'prepare'>,
  input: {
    userId: string
    lifecycleGeneration: string
    deletedCount: number
    now: string
    errorCode: string | null
  },
): Promise<AccountLifecycleMutationResult> {
  if (
    !Number.isSafeInteger(input.deletedCount) ||
    input.deletedCount < 0 ||
    (input.errorCode !== null && !/^[a-z0-9_]{1,64}$/u.test(input.errorCode))
  ) {
    throw new Error('account purge progress is invalid')
  }
  const result = await database
    .prepare(
      `
        UPDATE account_deletions
        SET
          personal_r2_deleted_count = ?,
          last_error_code = ?,
          updated_at = ?
        WHERE user_id = ?
          AND lifecycle_generation = ?
          AND state = 'purging_r2'
          AND personal_r2_expected_count >= ?
          AND personal_r2_deleted_count <= ?
      `,
    )
    .bind(
      input.deletedCount,
      input.errorCode,
      input.now,
      input.userId,
      input.lifecycleGeneration,
      input.deletedCount,
      input.deletedCount,
    )
    .run()
  return result.meta.changes === 1
    ? { status: 'updated' }
    : { status: 'unavailable' }
}

export async function finalizeAccountPurge(
  database: AccountLifecycleDatabase,
  input: {
    userId: string
    lifecycleGeneration: string
    tombstoneEmail: string
    tombstoneMasterPasswordHash: string
    nextSecurityStamp: string
    now: string
    auditEventId: string
    auditEvent: AuditEvent
  },
): Promise<{ status: 'tombstoned' | 'conflict' }> {
  const event = input.auditEvent
  const sealedGuard = `
    SELECT 1 FROM account_deletions
    WHERE user_id = ?
      AND lifecycle_generation = ?
      AND state = 'purging_r2'
      AND personal_r2_deleted_count = personal_r2_expected_count
      AND purge_operation_id = ?
  `
  const sealedBindings = [
    input.userId,
    input.lifecycleGeneration,
    input.auditEventId,
  ] as const
  const tombstonedGuard = `
    SELECT 1 FROM account_deletions
    WHERE user_id = ?
      AND lifecycle_generation = ?
      AND state = 'tombstoned'
      AND tombstoned_at = ?
  `
  const tombstonedBindings = [
    input.userId,
    input.lifecycleGeneration,
    input.now,
  ] as const
  const results = await database.batch([
    database
      .prepare(
        `
          UPDATE account_deletions
          SET purge_operation_id = ?, updated_at = ?
          WHERE user_id = ?
            AND lifecycle_generation = ?
            AND state = 'purging_r2'
            AND personal_r2_deleted_count = personal_r2_expected_count
            AND NOT EXISTS (${lastConfirmedOwnerMembershipSql})
            AND personal_r2_expected_count = (
              SELECT COUNT(*)
              FROM cipher_attachments AS attachment
              JOIN ciphers AS cipher ON cipher.id = attachment.cipher_id
              WHERE cipher.user_id = account_deletions.user_id
                AND cipher.organization_id IS NULL
            )
          RETURNING personal_r2_expected_count as expectedCount
        `,
      )
      .bind(
        input.auditEventId,
        input.now,
        input.userId,
        input.lifecycleGeneration,
        input.userId,
        input.userId,
      ),
    database
      .prepare(
        `
          UPDATE ciphers SET folder_id = NULL
          WHERE user_id = ? AND organization_id IS NOT NULL
            AND EXISTS (${sealedGuard})
        `,
      )
      .bind(input.userId, ...sealedBindings),
    database
      .prepare(
        `
          DELETE FROM cipher_attachments
          WHERE cipher_id IN (
            SELECT id FROM ciphers
            WHERE user_id = ? AND organization_id IS NULL
          )
          AND EXISTS (${sealedGuard})
        `,
      )
      .bind(input.userId, ...sealedBindings),
    database
      .prepare(
        `DELETE FROM ciphers
        WHERE user_id = ? AND organization_id IS NULL
          AND EXISTS (${sealedGuard})`,
      )
      .bind(input.userId, ...sealedBindings),
    database
      .prepare(
        `DELETE FROM folders WHERE user_id = ? AND EXISTS (${sealedGuard})`,
      )
      .bind(input.userId, ...sealedBindings),
    database
      .prepare(
        `DELETE FROM refresh_tokens
        WHERE user_id = ? AND EXISTS (${sealedGuard})`,
      )
      .bind(input.userId, ...sealedBindings),
    database
      .prepare(
        `DELETE FROM devices WHERE user_id = ? AND EXISTS (${sealedGuard})`,
      )
      .bind(input.userId, ...sealedBindings),
    database
      .prepare(
        `DELETE FROM auth_requests
        WHERE user_id = ? AND EXISTS (${sealedGuard})`,
      )
      .bind(input.userId, ...sealedBindings),
    database
      .prepare(
        `DELETE FROM account_lifecycle_tokens
        WHERE user_id = ? AND EXISTS (${sealedGuard})`,
      )
      .bind(input.userId, ...sealedBindings),
    database
      .prepare(
        `DELETE FROM user_key_rotation_wrapper_history
        WHERE user_id = ? AND EXISTS (${sealedGuard})`,
      )
      .bind(input.userId, ...sealedBindings),
    database
      .prepare(
        `DELETE FROM totp_challenges
        WHERE user_id = ? AND EXISTS (${sealedGuard})`,
      )
      .bind(input.userId, ...sealedBindings),
    database
      .prepare(
        `DELETE FROM user_totp WHERE user_id = ? AND EXISTS (${sealedGuard})`,
      )
      .bind(input.userId, ...sealedBindings),
    database
      .prepare(
        `
          UPDATE organization_users
          SET email = ?, org_key = NULL, permissions = NULL, updated_at = ?
          WHERE user_id = ? AND EXISTS (${sealedGuard})
        `,
      )
      .bind(input.tombstoneEmail, input.now, input.userId, ...sealedBindings),
    database
      .prepare(
        `
          UPDATE users
          SET
            email = ?,
            email_normalized = ?,
            email_verified_at = NULL,
            display_name = NULL,
            master_password_hash = ?,
            user_key = NULL,
            public_key = NULL,
            private_key = NULL,
            equivalent_domains = '[]',
            excluded_global_equivalent_domains = '[]',
            security_stamp = ?,
            revision_date = ?,
            login_failed_count = 0,
            login_failed_at = NULL,
            login_locked_until = NULL,
            updated_at = ?
          WHERE id = ?
            AND disabled_at IS NOT NULL
            AND EXISTS (${sealedGuard})
          RETURNING id
        `,
      )
      .bind(
        input.tombstoneEmail,
        input.tombstoneEmail,
        input.tombstoneMasterPasswordHash,
        input.nextSecurityStamp,
        input.now,
        input.now,
        input.userId,
        ...sealedBindings,
      ),
    database
      .prepare(
        `
          UPDATE account_deletions
          SET state = 'tombstoned', tombstoned_at = ?, updated_at = ?
          WHERE user_id = ?
            AND lifecycle_generation = ?
            AND state = 'purging_r2'
            AND updated_at = ?
        `,
      )
      .bind(
        input.now,
        input.now,
        input.userId,
        input.lifecycleGeneration,
        input.now,
      ),
    database
      .prepare(
        `
          INSERT INTO audit_events (
            id, schema_version, name, outcome, request_id, occurred_at,
            actor_user_id, actor_device_identifier, target_type, target_id,
            context_json
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (${tombstonedGuard})
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
        ...tombstonedBindings,
      ),
  ])
  if (results.length !== 16) {
    throw new Error(
      'account purge finalization batch returned an invalid count',
    )
  }
  const sealResult = results[0]
  const sealedRows = (sealResult?.results ?? []) as Array<{
    expectedCount: number
  }>
  if ((sealResult?.meta.changes ?? 0) === 0) {
    if (results.slice(1).some((result) => (result.meta.changes ?? 0) !== 0)) {
      throw new Error('account purge finalization guard invariant was violated')
    }
    return { status: 'conflict' }
  }
  const attachmentResult = results[2]
  const userResult = results[13]
  const deletionResult = results[14]
  const auditResult = results[15]
  const users = (userResult?.results ?? []) as Array<{ id: string }>
  if (
    sealedRows.length !== 1 ||
    !Number.isSafeInteger(sealedRows[0]?.expectedCount) ||
    (attachmentResult?.meta.changes ?? 0) !== sealedRows[0]?.expectedCount ||
    users.length !== 1 ||
    users[0]?.id !== input.userId ||
    (deletionResult?.meta.changes ?? 0) !== 1 ||
    (auditResult?.meta.changes ?? 0) !== 1
  ) {
    throw new Error('account purge finalization did not commit once')
  }
  return { status: 'tombstoned' }
}
