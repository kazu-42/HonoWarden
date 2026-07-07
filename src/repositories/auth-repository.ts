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
  deviceIdentifier: string
  deviceName: string | null
  deviceType: number | null
  refreshTokenId: string
  refreshTokenHash: string
  refreshTokenExpiresAt: string
  now: string
}

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

type AuthLookupDatabase = Pick<D1Database, 'prepare'>
type AuthSessionDatabase = Pick<D1Database, 'batch' | 'prepare'>
type AuthDeviceRevokeDatabase = Pick<D1Database, 'prepare'>
type LoginDefenseDatabase = Pick<D1Database, 'prepare'>

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
): Promise<void> {
  const deviceId = buildDeviceId(input.userId, input.deviceIdentifier)

  await database.batch([
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
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        deviceId,
        input.userId,
        input.deviceIdentifier,
        input.deviceName,
        input.deviceType,
        input.now,
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
        `,
      )
      .bind(
        input.deviceName,
        input.deviceType,
        input.now,
        input.now,
        deviceId,
        input.userId,
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
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .bind(
        input.refreshTokenId,
        input.userId,
        deviceId,
        input.refreshTokenHash,
        input.refreshTokenExpiresAt,
      ),
  ])
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

export async function rotateRefreshToken(
  database: AuthSessionDatabase,
  input: RotateRefreshTokenInput,
): Promise<RotateRefreshTokenResult> {
  const revokeResult = await database
    .prepare(
      `
        UPDATE refresh_tokens
        SET revoked_at = ?
        WHERE id = ? AND user_id = ? AND device_id = ? AND revoked_at IS NULL
      `,
    )
    .bind(input.now, input.currentTokenId, input.userId, input.deviceId)
    .run()

  if (revokeResult.meta.changes !== 1) {
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

  await database.batch([
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
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        input.nextRefreshTokenId,
        input.userId,
        input.deviceId,
        input.nextRefreshTokenHash,
        input.currentTokenId,
        input.nextRefreshTokenExpiresAt,
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
          WHERE id = ? AND user_id = ?
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
      ),
  ])

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
