import { refreshTokenRetentionDays } from '../domain/tokens'

export type AuthUserRecord = {
  id: string
  email: string
  emailNormalized: string
  displayName: string | null
  kdfAlgorithm: string
  kdfIterations: number
  kdfMemory: number | null
  kdfParallelism: number | null
  masterPasswordHash: string
  userKey: string | null
  publicKey: string | null
  privateKey: string | null
  securityStamp: string
  revisionDate: string
  createdAt: string
  disabledAt: string | null
  loginFailedCount: number
  loginFailedAt: string | null
  loginLockedUntil: string | null
  totpEnabled: boolean
  totpEncryptedSecret: string | null
  totpLastAcceptedStep: number | null
}

export type DeviceSessionInput = {
  userId: string
  expectedMasterPasswordHash: string
  expectedSecurityStamp: string
  deviceIdentifier: string
  deviceName: string | null
  deviceType: number | null
  refreshTokenId: string
  refreshTokenHash: string
  refreshTokenExpiresAt: string
  now: string
}

export type CreatePasswordGrantSessionResult =
  { status: 'created' } | { status: 'stale_generation' }

export type RefreshTokenSession = {
  tokenId: string
  userId: string
  deviceId: string
  deviceIdentifier: string
  tokenExpiresAt: string
  tokenRevokedAt: string | null
  deviceRevokedAt: string | null
  user: AuthUserRecord
}

export type RotateRefreshTokenInput = {
  currentTokenId: string
  userId: string
  deviceId: string
  expectedSecurityStamp: string
  deviceIdentifier: string
  deviceName: string | null
  deviceType: number | null
  nextRefreshTokenId: string
  nextRefreshTokenHash: string
  nextRefreshTokenExpiresAt: string
  now: string
}

export type DeviceRevokeInput = {
  userId: string
  deviceId: string
  revokedAt: string
}

export type RevokeOtherDeviceSessionsInput = {
  userId: string
  currentDeviceId: string
  revokedAt: string
}

export type RevokeOtherDeviceSessionsResult = {
  currentDeviceId: string
  currentSessionRevoked: false
  revokedAt: string
}

export type DeviceRecord = {
  id: string
  userId: string
  identifier: string
  name: string | null
  type: number | null
  encryptedUserKey: string | null
  encryptedPublicKey: string | null
  encryptedPrivateKey: string | null
  lastSeenAt: string | null
  createdAt: string
  updatedAt: string
}

export type DeviceByIdentifierInput = {
  userId: string
  identifier: string
}

export type DeviceByIdInput = {
  userId: string
  deviceId: string
}

export type DeviceMetadataUpdateInput = {
  userId: string
  deviceId: string
  name: string
  type: number
  updatedAt: string
}

export type DeviceMetadataUpdateResult =
  | {
      status: 'updated'
      device: DeviceRecord
    }
  | {
      status: 'not_found'
    }

export type DeviceKeysUpdateInput = {
  userId: string
  deviceIdOrIdentifier: string
  encryptedUserKey: string
  encryptedPublicKey: string
  encryptedPrivateKey: string
  updatedAt: string
}

export type DeviceKeysUpdateResult =
  | {
      status: 'updated'
      device: DeviceRecord
    }
  | {
      status: 'not_found'
    }

export type TrustedDeviceKeysUpdate = {
  deviceIdOrIdentifier: string
  encryptedUserKey: string
  encryptedPublicKey: string
  encryptedPrivateKey: string
}

export type TrustedDeviceKeysUpdateInput = {
  userId: string
  devices: TrustedDeviceKeysUpdate[]
  updatedAt: string
}

export type TrustedDeviceKeysUpdateResult =
  | {
      status: 'updated'
      devices: DeviceRecord[]
    }
  | {
      status: 'not_found'
      missingDeviceIdOrIdentifier: string
    }

export type KnownDeviceInput = {
  emailNormalized: string
  identifier: string
}

export type FailedLoginInput = {
  userId: string
  failedCount: number
  failedAt: string
  lockedUntil: string | null
}

export type LoginDefenseResetInput = {
  userId: string
  resetAt: string
}

export type AuthAttemptInput = {
  id: string
  bucketKey: string
  subjectKey: string | null
  successful: boolean
  occurredAt: string
}

export type FailedAuthAttemptCountInput = {
  bucketKey: string
  occurredAfter: string
}

export type AuthFailureBucketRecord = {
  bucketKey: string
  failedCount: number
  windowStartedAt: string
  lockedUntil: string | null
  updatedAt: string
}

export type FailedAuthBucketInput = {
  bucketKey: string
  failureLimit: number
  failureWindowSeconds: number
  lockoutSeconds: number
  now: string
}

export type RotateRefreshTokenResult =
  | {
      status: 'rotated'
    }
  | {
      status: 'reuse_detected'
    }

export type DeviceRevokeResult =
  | {
      status: 'revoked'
      deviceId: string
      revokedAt: string
    }
  | {
      status: 'not_found'
    }

export type AuthDefenseCleanupInput = {
  now: string
  authAttemptExpiredBefore: string
  authFailureBucketExpiredBefore: string
  maxRowsPerQuery: number
}

export type AuthDefenseCleanupResult = {
  deletedAuthAttempts: number
  deletedAuthFailureBuckets: number
}

type AuthLookupDatabase = Pick<D1Database, 'prepare'>
type AuthSessionDatabase = Pick<D1Database, 'batch' | 'prepare'>
type AuthDeviceRevokeDatabase = Pick<D1Database, 'prepare'>
type AuthSessionRevokeDatabase = Pick<D1Database, 'batch' | 'prepare'>
type AuthDeviceReadDatabase = Pick<D1Database, 'prepare'>
type AuthDeviceMetadataDatabase = Pick<D1Database, 'prepare'>
type AuthDeviceKeysDatabase = Pick<D1Database, 'prepare'>
type AuthDeviceTrustDatabase = Pick<D1Database, 'batch' | 'prepare'>
type LoginDefenseDatabase = Pick<D1Database, 'prepare'>
type RefreshTokenRetentionDatabase = Pick<D1Database, 'prepare'>

type AuthUserRow = {
  id: string
  email: string
  emailNormalized: string
  displayName: string | null
  kdfAlgorithm: string
  kdfIterations: number
  kdfMemory: number | null
  kdfParallelism: number | null
  masterPasswordHash: string
  userKey: string | null
  publicKey: string | null
  privateKey: string | null
  securityStamp: string
  revisionDate: string
  createdAt: string
  disabledAt: string | null
  loginFailedCount: number
  loginFailedAt: string | null
  loginLockedUntil: string | null
  totpEnabled: number | boolean | null
  totpEncryptedSecret: string | null
  totpLastAcceptedStep: number | null
}

type RefreshTokenSessionRow = {
  tokenId: string
  userId: string
  deviceId: string
  deviceIdentifier: string
  tokenExpiresAt: string
  tokenRevokedAt: string | null
  deviceRevokedAt: string | null
  email: string
  emailNormalized: string
  displayName: string | null
  kdfAlgorithm: string
  kdfIterations: number
  kdfMemory: number | null
  kdfParallelism: number | null
  masterPasswordHash: string
  userKey: string | null
  publicKey: string | null
  privateKey: string | null
  securityStamp: string
  revisionDate: string
  createdAt: string
  disabledAt: string | null
  loginFailedCount: number
  loginFailedAt: string | null
  loginLockedUntil: string | null
  totpEnabled: number | boolean | null
  totpEncryptedSecret: string | null
  totpLastAcceptedStep: number | null
}

type FailedAuthAttemptCountRow = {
  count: number
}

type AuthFailureBucketRow = {
  bucketKey: string
  failedCount: number
  windowStartedAt: string
  lockedUntil: string | null
  updatedAt: string
}

type DeviceRow = {
  id: string
  userId: string
  identifier: string
  name: string | null
  type: number | null
  encryptedUserKey: string | null
  encryptedPublicKey: string | null
  encryptedPrivateKey: string | null
  lastSeenAt: string | null
  createdAt: string
  updatedAt: string
}

type KnownDeviceRow = {
  found: number
}

export async function findAuthUserByEmail(
  database: AuthLookupDatabase,
  emailNormalized: string,
): Promise<AuthUserRecord | null> {
  const row = await database
    .prepare(
      `
        SELECT
          u.id,
          u.email,
          u.email_normalized as emailNormalized,
          u.display_name as displayName,
          u.kdf_algorithm as kdfAlgorithm,
          u.kdf_iterations as kdfIterations,
          u.kdf_memory as kdfMemory,
          u.kdf_parallelism as kdfParallelism,
          u.master_password_hash as masterPasswordHash,
          u.user_key as userKey,
          u.public_key as publicKey,
          u.private_key as privateKey,
          u.security_stamp as securityStamp,
          u.revision_date as revisionDate,
          u.created_at as createdAt,
          u.disabled_at as disabledAt,
          u.login_failed_count as loginFailedCount,
          u.login_failed_at as loginFailedAt,
          u.login_locked_until as loginLockedUntil,
          COALESCE(ut.enabled, 0) as totpEnabled,
          ut.encrypted_secret as totpEncryptedSecret,
          ut.last_accepted_step as totpLastAcceptedStep
        FROM users u
        LEFT JOIN user_totp ut ON ut.user_id = u.id
        WHERE u.email_normalized = ?
        LIMIT 1
      `,
    )
    .bind(emailNormalized)
    .first<AuthUserRow>()

  return row ? authUserFromRow(row) : null
}

export async function findAuthUserById(
  database: AuthLookupDatabase,
  userId: string,
): Promise<AuthUserRecord | null> {
  const row = await database
    .prepare(
      `
        SELECT
          u.id,
          u.email,
          u.email_normalized as emailNormalized,
          u.display_name as displayName,
          u.kdf_algorithm as kdfAlgorithm,
          u.kdf_iterations as kdfIterations,
          u.kdf_memory as kdfMemory,
          u.kdf_parallelism as kdfParallelism,
          u.master_password_hash as masterPasswordHash,
          u.user_key as userKey,
          u.public_key as publicKey,
          u.private_key as privateKey,
          u.security_stamp as securityStamp,
          u.revision_date as revisionDate,
          u.created_at as createdAt,
          u.disabled_at as disabledAt,
          u.login_failed_count as loginFailedCount,
          u.login_failed_at as loginFailedAt,
          u.login_locked_until as loginLockedUntil,
          COALESCE(ut.enabled, 0) as totpEnabled,
          ut.encrypted_secret as totpEncryptedSecret,
          ut.last_accepted_step as totpLastAcceptedStep
        FROM users u
        LEFT JOIN user_totp ut ON ut.user_id = u.id
        WHERE u.id = ?
        LIMIT 1
      `,
    )
    .bind(userId)
    .first<AuthUserRow>()

  return row ? authUserFromRow(row) : null
}

export async function createPasswordGrantSession(
  database: AuthSessionDatabase,
  input: DeviceSessionInput,
): Promise<CreatePasswordGrantSessionResult> {
  const deviceId = buildDeviceId(input.userId, input.deviceIdentifier)

  const results = await database.batch([
    database
      .prepare(
        `
          INSERT OR IGNORE INTO devices (
            id,
            user_id,
            identifier,
            name,
            type,
            last_seen_at
          )
          SELECT ?, ?, ?, ?, ?, ?
          FROM users
          WHERE id = ?
            AND disabled_at IS NULL
            AND master_password_hash = ?
            AND security_stamp = ?
        `,
      )
      .bind(
        deviceId,
        input.userId,
        input.deviceIdentifier,
        input.deviceName,
        input.deviceType,
        input.now,
        input.userId,
        input.expectedMasterPasswordHash,
        input.expectedSecurityStamp,
      ),
    database
      .prepare(
        `
          UPDATE devices
          SET
            name = ?,
            type = ?,
            last_seen_at = ?,
            revoked_at = NULL,
            updated_at = ?
          WHERE id = ? AND user_id = ?
            AND EXISTS (
              SELECT 1
              FROM users
              WHERE id = ?
                AND disabled_at IS NULL
                AND master_password_hash = ?
                AND security_stamp = ?
            )
        `,
      )
      .bind(
        input.deviceName,
        input.deviceType,
        input.now,
        input.now,
        deviceId,
        input.userId,
        input.userId,
        input.expectedMasterPasswordHash,
        input.expectedSecurityStamp,
      ),
    database
      .prepare(
        `
          INSERT INTO refresh_tokens (
            id,
            user_id,
            device_id,
            token_hash,
            expires_at
          )
          SELECT ?, ?, ?, ?, ?
          FROM users
          WHERE id = ?
            AND disabled_at IS NULL
            AND master_password_hash = ?
            AND security_stamp = ?
            AND EXISTS (
              SELECT 1
              FROM devices
              WHERE id = ?
                AND user_id = ?
                AND revoked_at IS NULL
            )
        `,
      )
      .bind(
        input.refreshTokenId,
        input.userId,
        deviceId,
        input.refreshTokenHash,
        input.refreshTokenExpiresAt,
        input.userId,
        input.expectedMasterPasswordHash,
        input.expectedSecurityStamp,
        deviceId,
        input.userId,
      ),
  ])

  if (results.length !== 3) {
    throw new Error('password session batch returned an invalid result count')
  }
  const refreshTokenChanges = results[2]?.meta.changes ?? 0
  if (refreshTokenChanges === 0) {
    return { status: 'stale_generation' }
  }
  if (refreshTokenChanges !== 1) {
    throw new Error('password session batch created an invalid token count')
  }

  return { status: 'created' }
}

export async function listDevicesByUser(
  database: AuthDeviceReadDatabase,
  userId: string,
): Promise<DeviceRecord[]> {
  const result = await database
    .prepare(
      `
        SELECT
          id,
          user_id as userId,
          identifier,
          name,
          type,
          encrypted_user_key as encryptedUserKey,
          encrypted_public_key as encryptedPublicKey,
          encrypted_private_key as encryptedPrivateKey,
          last_seen_at as lastSeenAt,
          created_at as createdAt,
          updated_at as updatedAt
        FROM devices
        WHERE user_id = ?
          AND revoked_at IS NULL
        ORDER BY
          COALESCE(last_seen_at, updated_at, created_at) DESC,
          created_at DESC,
          id ASC
      `,
    )
    .bind(userId)
    .all<DeviceRow>()

  return result.results.map(deviceFromRow)
}

export async function findDeviceByIdentifier(
  database: AuthDeviceReadDatabase,
  input: DeviceByIdentifierInput,
): Promise<DeviceRecord | null> {
  const row = await database
    .prepare(
      `
        SELECT
          id,
          user_id as userId,
          identifier,
          name,
          type,
          encrypted_user_key as encryptedUserKey,
          encrypted_public_key as encryptedPublicKey,
          encrypted_private_key as encryptedPrivateKey,
          last_seen_at as lastSeenAt,
          created_at as createdAt,
          updated_at as updatedAt
        FROM devices
        WHERE user_id = ?
          AND identifier = ?
          AND revoked_at IS NULL
        LIMIT 1
      `,
    )
    .bind(input.userId, input.identifier)
    .first<DeviceRow>()

  return row ? deviceFromRow(row) : null
}

export async function findDeviceById(
  database: AuthDeviceReadDatabase,
  input: DeviceByIdInput,
): Promise<DeviceRecord | null> {
  const row = await database
    .prepare(
      `
        SELECT
          id,
          user_id as userId,
          identifier,
          name,
          type,
          encrypted_user_key as encryptedUserKey,
          encrypted_public_key as encryptedPublicKey,
          encrypted_private_key as encryptedPrivateKey,
          last_seen_at as lastSeenAt,
          created_at as createdAt,
          updated_at as updatedAt
        FROM devices
        WHERE user_id = ?
          AND id = ?
          AND revoked_at IS NULL
        LIMIT 1
      `,
    )
    .bind(input.userId, input.deviceId)
    .first<DeviceRow>()

  return row ? deviceFromRow(row) : null
}

export async function updateDeviceMetadata(
  database: AuthDeviceMetadataDatabase,
  input: DeviceMetadataUpdateInput,
): Promise<DeviceMetadataUpdateResult> {
  const existing = await findDeviceById(database, {
    userId: input.userId,
    deviceId: input.deviceId,
  })

  if (!existing) {
    return {
      status: 'not_found',
    }
  }

  const result = await database
    .prepare(
      `
        UPDATE devices
        SET
          name = ?,
          type = ?,
          updated_at = ?
        WHERE user_id = ?
          AND id = ?
          AND revoked_at IS NULL
      `,
    )
    .bind(input.name, input.type, input.updatedAt, input.userId, input.deviceId)
    .run()

  if (result.meta.changes !== 1) {
    return {
      status: 'not_found',
    }
  }

  return {
    status: 'updated',
    device: {
      ...existing,
      name: input.name,
      type: input.type,
      updatedAt: input.updatedAt,
    },
  }
}

export async function updateDeviceKeys(
  database: AuthDeviceKeysDatabase,
  input: DeviceKeysUpdateInput,
): Promise<DeviceKeysUpdateResult> {
  const existing = await findDeviceByIdOrIdentifier(database, {
    userId: input.userId,
    deviceIdOrIdentifier: input.deviceIdOrIdentifier,
  })

  if (!existing) {
    return {
      status: 'not_found',
    }
  }

  const result = await database
    .prepare(
      `
        UPDATE devices
        SET
          encrypted_user_key = ?,
          encrypted_public_key = ?,
          encrypted_private_key = ?,
          updated_at = ?
        WHERE user_id = ?
          AND id = ?
          AND revoked_at IS NULL
      `,
    )
    .bind(
      input.encryptedUserKey,
      input.encryptedPublicKey,
      input.encryptedPrivateKey,
      input.updatedAt,
      input.userId,
      existing.id,
    )
    .run()

  if (result.meta.changes !== 1) {
    return {
      status: 'not_found',
    }
  }

  return {
    status: 'updated',
    device: {
      ...existing,
      encryptedUserKey: input.encryptedUserKey,
      encryptedPublicKey: input.encryptedPublicKey,
      encryptedPrivateKey: input.encryptedPrivateKey,
      updatedAt: input.updatedAt,
    },
  }
}

export async function updateTrustedDeviceKeys(
  database: AuthDeviceTrustDatabase,
  input: TrustedDeviceKeysUpdateInput,
): Promise<TrustedDeviceKeysUpdateResult> {
  const resolvedDevices: {
    existing: DeviceRecord
    update: TrustedDeviceKeysUpdate
  }[] = []

  for (const update of input.devices) {
    const existing = await findDeviceByIdOrIdentifier(database, {
      userId: input.userId,
      deviceIdOrIdentifier: update.deviceIdOrIdentifier,
    })

    if (!existing) {
      return {
        status: 'not_found',
        missingDeviceIdOrIdentifier: update.deviceIdOrIdentifier,
      }
    }

    resolvedDevices.push({ existing, update })
  }

  const results = await database.batch(
    resolvedDevices.map(({ existing, update }) =>
      database
        .prepare(
          `
            UPDATE devices
            SET
              encrypted_user_key = ?,
              encrypted_public_key = ?,
              encrypted_private_key = ?,
              updated_at = ?
            WHERE user_id = ?
              AND id = ?
              AND revoked_at IS NULL
          `,
        )
        .bind(
          update.encryptedUserKey,
          update.encryptedPublicKey,
          update.encryptedPrivateKey,
          input.updatedAt,
          input.userId,
          existing.id,
        ),
    ),
  )

  const failedIndex = results.findIndex((result) => result.meta.changes !== 1)
  if (failedIndex !== -1) {
    return {
      status: 'not_found',
      missingDeviceIdOrIdentifier:
        resolvedDevices[failedIndex]?.update.deviceIdOrIdentifier ?? '',
    }
  }

  return {
    status: 'updated',
    devices: resolvedDevices.map(({ existing, update }) => ({
      ...existing,
      encryptedUserKey: update.encryptedUserKey,
      encryptedPublicKey: update.encryptedPublicKey,
      encryptedPrivateKey: update.encryptedPrivateKey,
      updatedAt: input.updatedAt,
    })),
  }
}

async function findDeviceByIdOrIdentifier(
  database: AuthDeviceReadDatabase,
  input: {
    userId: string
    deviceIdOrIdentifier: string
  },
): Promise<DeviceRecord | null> {
  const byId = await findDeviceById(database, {
    userId: input.userId,
    deviceId: input.deviceIdOrIdentifier,
  })

  if (byId) {
    return byId
  }

  return findDeviceByIdentifier(database, {
    userId: input.userId,
    identifier: input.deviceIdOrIdentifier,
  })
}

export async function knownActiveDeviceExists(
  database: AuthDeviceReadDatabase,
  input: KnownDeviceInput,
): Promise<boolean> {
  const row = await database
    .prepare(
      `
        SELECT
          1 as found
        FROM users u
        JOIN devices d ON d.user_id = u.id
        WHERE u.email_normalized = ?
          AND u.disabled_at IS NULL
          AND d.identifier = ?
          AND d.revoked_at IS NULL
        LIMIT 1
      `,
    )
    .bind(input.emailNormalized, input.identifier)
    .first<KnownDeviceRow>()

  return row?.found === 1
}

export async function findRefreshTokenSessionByHash(
  database: AuthLookupDatabase,
  refreshTokenHash: string,
): Promise<RefreshTokenSession | null> {
  const row = await database
    .prepare(
      `
        SELECT
          rt.id as tokenId,
          rt.user_id as userId,
          rt.device_id as deviceId,
          d.identifier as deviceIdentifier,
          rt.expires_at as tokenExpiresAt,
          rt.revoked_at as tokenRevokedAt,
          d.revoked_at as deviceRevokedAt,
          u.email,
          u.email_normalized as emailNormalized,
          u.display_name as displayName,
          u.kdf_algorithm as kdfAlgorithm,
          u.kdf_iterations as kdfIterations,
          u.kdf_memory as kdfMemory,
          u.kdf_parallelism as kdfParallelism,
          u.master_password_hash as masterPasswordHash,
          u.user_key as userKey,
          u.public_key as publicKey,
          u.private_key as privateKey,
          u.security_stamp as securityStamp,
          u.revision_date as revisionDate,
          u.created_at as createdAt,
          u.disabled_at as disabledAt,
          u.login_failed_count as loginFailedCount,
          u.login_failed_at as loginFailedAt,
          u.login_locked_until as loginLockedUntil,
          COALESCE(ut.enabled, 0) as totpEnabled,
          ut.encrypted_secret as totpEncryptedSecret,
          ut.last_accepted_step as totpLastAcceptedStep
        FROM refresh_tokens rt
        INNER JOIN users u ON u.id = rt.user_id
        INNER JOIN devices d ON d.id = rt.device_id
        LEFT JOIN user_totp ut ON ut.user_id = u.id
        WHERE rt.token_hash = ?
        LIMIT 1
      `,
    )
    .bind(refreshTokenHash)
    .first<RefreshTokenSessionRow>()

  if (!row) {
    return null
  }

  return {
    tokenId: row.tokenId,
    userId: row.userId,
    deviceId: row.deviceId,
    deviceIdentifier: row.deviceIdentifier,
    tokenExpiresAt: row.tokenExpiresAt,
    tokenRevokedAt: row.tokenRevokedAt,
    deviceRevokedAt: row.deviceRevokedAt,
    user: {
      id: row.userId,
      email: row.email,
      emailNormalized: row.emailNormalized,
      displayName: row.displayName,
      kdfAlgorithm: row.kdfAlgorithm,
      kdfIterations: row.kdfIterations,
      kdfMemory: row.kdfMemory,
      kdfParallelism: row.kdfParallelism,
      masterPasswordHash: row.masterPasswordHash,
      userKey: row.userKey,
      publicKey: row.publicKey,
      privateKey: row.privateKey,
      securityStamp: row.securityStamp,
      revisionDate: row.revisionDate,
      createdAt: row.createdAt,
      disabledAt: row.disabledAt,
      loginFailedCount: row.loginFailedCount,
      loginFailedAt: row.loginFailedAt,
      loginLockedUntil: row.loginLockedUntil,
      totpEnabled: row.totpEnabled === 1 || row.totpEnabled === true,
      totpEncryptedSecret: row.totpEncryptedSecret ?? null,
      totpLastAcceptedStep: row.totpLastAcceptedStep ?? null,
    },
  }
}

export async function recordFailedLogin(
  database: LoginDefenseDatabase,
  input: FailedLoginInput,
): Promise<void> {
  await database
    .prepare(
      `
        UPDATE users
        SET
          login_failed_count = ?,
          login_failed_at = ?,
          login_locked_until = ?,
          updated_at = ?
        WHERE id = ?
      `,
    )
    .bind(
      input.failedCount,
      input.failedAt,
      input.lockedUntil,
      input.failedAt,
      input.userId,
    )
    .run()
}

export async function resetLoginDefenseState(
  database: LoginDefenseDatabase,
  input: LoginDefenseResetInput,
): Promise<void> {
  await database
    .prepare(
      `
        UPDATE users
        SET
          login_failed_count = 0,
          login_failed_at = NULL,
          login_locked_until = NULL,
          updated_at = ?
        WHERE id = ?
      `,
    )
    .bind(input.resetAt, input.userId)
    .run()
}

export async function recordAuthAttempt(
  database: LoginDefenseDatabase,
  input: AuthAttemptInput,
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO auth_attempts (
          id,
          bucket_key,
          subject_key,
          successful,
          occurred_at
        )
        VALUES (?, ?, ?, ?, ?)
      `,
    )
    .bind(
      input.id,
      input.bucketKey,
      input.subjectKey,
      input.successful ? 1 : 0,
      input.occurredAt,
    )
    .run()
}

export async function countRecentFailedAuthAttempts(
  database: LoginDefenseDatabase,
  input: FailedAuthAttemptCountInput,
): Promise<number> {
  const row = await database
    .prepare(
      `
        SELECT COUNT(*) as count
        FROM auth_attempts
        WHERE bucket_key = ? AND successful = 0 AND occurred_at >= ?
      `,
    )
    .bind(input.bucketKey, input.occurredAfter)
    .first<FailedAuthAttemptCountRow>()

  return row?.count ?? 0
}

export async function findAuthFailureBucket(
  database: LoginDefenseDatabase,
  bucketKey: string,
): Promise<AuthFailureBucketRecord | null> {
  const row = await database
    .prepare(
      `
        SELECT
          bucket_key as bucketKey,
          failed_count as failedCount,
          window_started_at as windowStartedAt,
          locked_until as lockedUntil,
          updated_at as updatedAt
        FROM auth_failure_buckets
        WHERE bucket_key = ?
        LIMIT 1
      `,
    )
    .bind(bucketKey)
    .first<AuthFailureBucketRow>()

  return row ? authFailureBucketFromRow(row) : null
}

export async function recordFailedAuthBucket(
  database: LoginDefenseDatabase,
  input: FailedAuthBucketInput,
): Promise<AuthFailureBucketRecord> {
  const nowMs = Date.parse(input.now)
  const windowThreshold = new Date(
    nowMs - input.failureWindowSeconds * 1000,
  ).toISOString()
  const lockedUntil = new Date(
    nowMs + input.lockoutSeconds * 1000,
  ).toISOString()
  const firstFailureLockedUntil = input.failureLimit <= 1 ? lockedUntil : null

  await database
    .prepare(
      `
        INSERT INTO auth_failure_buckets (
          bucket_key,
          failed_count,
          window_started_at,
          locked_until,
          updated_at
        )
        VALUES (?, 1, ?, ?, ?)
        ON CONFLICT(bucket_key) DO UPDATE SET
          failed_count = CASE
            WHEN auth_failure_buckets.window_started_at >= ?
              THEN auth_failure_buckets.failed_count + 1
            ELSE 1
          END,
          window_started_at = CASE
            WHEN auth_failure_buckets.window_started_at >= ?
              THEN auth_failure_buckets.window_started_at
            ELSE excluded.window_started_at
          END,
          locked_until = CASE
            WHEN (
              CASE
                WHEN auth_failure_buckets.window_started_at >= ?
                  THEN auth_failure_buckets.failed_count + 1
                ELSE 1
              END
            ) >= ? THEN ?
            ELSE NULL
          END,
          updated_at = excluded.updated_at
      `,
    )
    .bind(
      input.bucketKey,
      input.now,
      firstFailureLockedUntil,
      input.now,
      windowThreshold,
      windowThreshold,
      windowThreshold,
      input.failureLimit,
      lockedUntil,
    )
    .run()

  const bucket = await findAuthFailureBucket(database, input.bucketKey)

  if (!bucket) {
    throw new Error('Failed auth bucket was not persisted.')
  }

  return bucket
}

export async function resetAuthFailureBucket(
  database: LoginDefenseDatabase,
  bucketKey: string,
): Promise<void> {
  await database
    .prepare(
      `
        DELETE FROM auth_failure_buckets
        WHERE bucket_key = ?
      `,
    )
    .bind(bucketKey)
    .run()
}

export async function cleanupExpiredAuthAttempts(
  database: LoginDefenseDatabase,
  input: {
    expiredBefore: string
    limit: number
  },
): Promise<number> {
  const result = await database
    .prepare(
      `
        DELETE FROM auth_attempts
        WHERE id IN (
          SELECT id
          FROM auth_attempts
          WHERE occurred_at < ?
          ORDER BY occurred_at ASC
          LIMIT ?
        )
      `,
    )
    .bind(input.expiredBefore, input.limit)
    .run()

  return result.meta.changes
}

export async function cleanupExpiredAuthFailureBuckets(
  database: LoginDefenseDatabase,
  input: {
    expiredBefore: string
    now: string
    limit: number
  },
): Promise<number> {
  const result = await database
    .prepare(
      `
        DELETE FROM auth_failure_buckets
        WHERE bucket_key IN (
          SELECT bucket_key
          FROM auth_failure_buckets
          WHERE updated_at < ?
            AND (locked_until IS NULL OR locked_until < ?)
          ORDER BY updated_at ASC
          LIMIT ?
        )
      `,
    )
    .bind(input.expiredBefore, input.now, input.limit)
    .run()

  return result.meta.changes
}

export async function cleanupAuthDefenseState(
  database: LoginDefenseDatabase,
  input: AuthDefenseCleanupInput,
): Promise<AuthDefenseCleanupResult> {
  const [deletedAuthAttempts, deletedAuthFailureBuckets] = await Promise.all([
    cleanupExpiredAuthAttempts(database, {
      expiredBefore: input.authAttemptExpiredBefore,
      limit: input.maxRowsPerQuery,
    }),
    cleanupExpiredAuthFailureBuckets(database, {
      expiredBefore: input.authFailureBucketExpiredBefore,
      now: input.now,
      limit: input.maxRowsPerQuery,
    }),
  ])

  return { deletedAuthAttempts, deletedAuthFailureBuckets }
}

export async function deleteExpiredRefreshTokens(
  database: RefreshTokenRetentionDatabase,
  input: { now: string; limit: number },
): Promise<number> {
  const expiredBefore = new Date(
    Date.parse(input.now) - refreshTokenRetentionDays * 86_400_000,
  ).toISOString()
  const result = await database
    .prepare(
      `
        DELETE FROM refresh_tokens
        WHERE id IN (
          SELECT id
          FROM refresh_tokens
          WHERE expires_at <= ?
          ORDER BY expires_at ASC
          LIMIT ?
        )
      `,
    )
    .bind(expiredBefore, input.limit)
    .run()

  return result.meta.changes
}

export async function rotateRefreshToken(
  database: AuthSessionDatabase,
  input: RotateRefreshTokenInput,
): Promise<RotateRefreshTokenResult> {
  const results = await database.batch([
    database
      .prepare(
        `
          INSERT INTO refresh_tokens (
            id,
            user_id,
            device_id,
            token_hash,
            rotated_from_token_id,
            expires_at
          )
          SELECT ?, current.user_id, current.device_id, ?, current.id, ?
          FROM refresh_tokens AS current
          INNER JOIN devices AS device
            ON device.id = current.device_id
            AND device.user_id = current.user_id
          INNER JOIN users AS owner
            ON owner.id = current.user_id
          WHERE current.id = ?
            AND current.user_id = ?
            AND current.device_id = ?
            AND current.revoked_at IS NULL
            AND device.revoked_at IS NULL
            AND owner.disabled_at IS NULL
            AND owner.security_stamp = ?
        `,
      )
      .bind(
        input.nextRefreshTokenId,
        input.nextRefreshTokenHash,
        input.nextRefreshTokenExpiresAt,
        input.currentTokenId,
        input.userId,
        input.deviceId,
        input.expectedSecurityStamp,
      ),
    database
      .prepare(
        `
          UPDATE refresh_tokens
          SET revoked_at = ?
          WHERE id = ?
            AND user_id = ?
            AND device_id = ?
            AND revoked_at IS NULL
            AND EXISTS (
              SELECT 1
              FROM refresh_tokens AS replacement
              WHERE replacement.id = ?
                AND replacement.user_id = refresh_tokens.user_id
                AND replacement.device_id = refresh_tokens.device_id
                AND replacement.rotated_from_token_id = refresh_tokens.id
                AND replacement.token_hash = ?
                AND replacement.revoked_at IS NULL
            )
        `,
      )
      .bind(
        input.now,
        input.currentTokenId,
        input.userId,
        input.deviceId,
        input.nextRefreshTokenId,
        input.nextRefreshTokenHash,
      ),
    database
      .prepare(
        `
          UPDATE devices
          SET
            identifier = ?,
            name = ?,
            type = ?,
            last_seen_at = ?,
            updated_at = ?
          WHERE id = ? AND user_id = ? AND revoked_at IS NULL
            AND EXISTS (
              SELECT 1
              FROM refresh_tokens AS replacement
              WHERE replacement.id = ?
                AND replacement.user_id = devices.user_id
                AND replacement.device_id = devices.id
                AND replacement.rotated_from_token_id = ?
                AND replacement.token_hash = ?
                AND replacement.revoked_at IS NULL
            )
        `,
      )
      .bind(
        input.deviceIdentifier,
        input.deviceName,
        input.deviceType,
        input.now,
        input.now,
        input.deviceId,
        input.userId,
        input.nextRefreshTokenId,
        input.currentTokenId,
        input.nextRefreshTokenHash,
      ),
  ])

  if (results.length !== 3) {
    throw new Error('refresh rotation batch returned an invalid result count')
  }
  const [replacementResult, revokeResult, deviceResult] = results
  if (
    replacementResult?.meta.changes !== 1 ||
    revokeResult?.meta.changes !== 1 ||
    deviceResult?.meta.changes !== 1
  ) {
    await invalidateRefreshTokenSession(
      database,
      input.userId,
      input.deviceId,
      input.now,
    )

    return {
      status: 'reuse_detected',
    }
  }

  return {
    status: 'rotated',
  }
}

export async function invalidateRefreshTokenSession(
  database: AuthSessionDatabase,
  userId: string,
  deviceId: string,
  now: string,
): Promise<void> {
  await database.batch([
    database
      .prepare(
        `
          UPDATE refresh_tokens
          SET revoked_at = ?
          WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL
        `,
      )
      .bind(now, userId, deviceId),
    database
      .prepare(
        `
          UPDATE devices
          SET revoked_at = ?, updated_at = ?
          WHERE id = ? AND user_id = ?
        `,
      )
      .bind(now, now, deviceId, userId),
  ])
}

export async function revokeDeviceSession(
  database: AuthDeviceRevokeDatabase,
  input: DeviceRevokeInput,
): Promise<DeviceRevokeResult> {
  const deviceResult = await database
    .prepare(
      `
        UPDATE devices
        SET revoked_at = ?, updated_at = ?
        WHERE id = ? AND user_id = ? AND revoked_at IS NULL
      `,
    )
    .bind(input.revokedAt, input.revokedAt, input.deviceId, input.userId)
    .run()

  if (deviceResult.meta.changes !== 1) {
    return {
      status: 'not_found',
    }
  }

  await database
    .prepare(
      `
        UPDATE refresh_tokens
        SET revoked_at = ?
        WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL
      `,
    )
    .bind(input.revokedAt, input.userId, input.deviceId)
    .run()

  return {
    status: 'revoked',
    deviceId: input.deviceId,
    revokedAt: input.revokedAt,
  }
}

export async function revokeOtherDeviceSessions(
  database: AuthSessionRevokeDatabase,
  input: RevokeOtherDeviceSessionsInput,
): Promise<RevokeOtherDeviceSessionsResult> {
  await database.batch([
    database
      .prepare(
        `
          UPDATE devices
          SET revoked_at = ?, updated_at = ?
          WHERE user_id = ? AND id <> ? AND revoked_at IS NULL
        `,
      )
      .bind(
        input.revokedAt,
        input.revokedAt,
        input.userId,
        input.currentDeviceId,
      ),
    database
      .prepare(
        `
          UPDATE refresh_tokens
          SET revoked_at = ?
          WHERE user_id = ? AND device_id <> ? AND revoked_at IS NULL
        `,
      )
      .bind(input.revokedAt, input.userId, input.currentDeviceId),
  ])

  return {
    currentDeviceId: input.currentDeviceId,
    currentSessionRevoked: false,
    revokedAt: input.revokedAt,
  }
}

export function buildDeviceId(
  userId: string,
  deviceIdentifier: string,
): string {
  return `${userId}:${deviceIdentifier}`
}

function authUserFromRow(row: AuthUserRow): AuthUserRecord {
  return {
    id: row.id,
    email: row.email,
    emailNormalized: row.emailNormalized,
    displayName: row.displayName,
    kdfAlgorithm: row.kdfAlgorithm,
    kdfIterations: row.kdfIterations,
    kdfMemory: row.kdfMemory,
    kdfParallelism: row.kdfParallelism,
    masterPasswordHash: row.masterPasswordHash,
    userKey: row.userKey,
    publicKey: row.publicKey,
    privateKey: row.privateKey,
    securityStamp: row.securityStamp,
    revisionDate: row.revisionDate,
    createdAt: row.createdAt,
    disabledAt: row.disabledAt,
    loginFailedCount: row.loginFailedCount,
    loginFailedAt: row.loginFailedAt,
    loginLockedUntil: row.loginLockedUntil,
    totpEnabled: row.totpEnabled === 1 || row.totpEnabled === true,
    totpEncryptedSecret: row.totpEncryptedSecret ?? null,
    totpLastAcceptedStep: row.totpLastAcceptedStep ?? null,
  }
}

function deviceFromRow(row: DeviceRow): DeviceRecord {
  return {
    id: row.id,
    userId: row.userId,
    identifier: row.identifier,
    name: row.name,
    type: row.type,
    encryptedUserKey: row.encryptedUserKey ?? null,
    encryptedPublicKey: row.encryptedPublicKey ?? null,
    encryptedPrivateKey: row.encryptedPrivateKey ?? null,
    lastSeenAt: row.lastSeenAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function authFailureBucketFromRow(
  row: AuthFailureBucketRow,
): AuthFailureBucketRecord {
  return {
    bucketKey: row.bucketKey,
    failedCount: row.failedCount,
    windowStartedAt: row.windowStartedAt,
    lockedUntil: row.lockedUntil,
    updatedAt: row.updatedAt,
  }
}
