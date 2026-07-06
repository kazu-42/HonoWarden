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
  privateKey: string | null
  securityStamp: string
  createdAt: string
  disabledAt: string | null
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

export type RotateRefreshTokenResult =
  | {
      status: 'rotated'
    }
  | {
      status: 'reuse_detected'
    }

type AuthLookupDatabase = Pick<D1Database, 'prepare'>
type AuthSessionDatabase = Pick<D1Database, 'batch' | 'prepare'>

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
  privateKey: string | null
  securityStamp: string
  createdAt: string
  disabledAt: string | null
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
  privateKey: string | null
  securityStamp: string
  createdAt: string
  disabledAt: string | null
}

export async function findAuthUserByEmail(
  database: AuthLookupDatabase,
  emailNormalized: string,
): Promise<AuthUserRecord | null> {
  const row = await database
    .prepare(
      `
        SELECT
          id,
          email,
          email_normalized as emailNormalized,
          display_name as displayName,
          kdf_algorithm as kdfAlgorithm,
          kdf_iterations as kdfIterations,
          kdf_memory as kdfMemory,
          kdf_parallelism as kdfParallelism,
          master_password_hash as masterPasswordHash,
          user_key as userKey,
          private_key as privateKey,
          security_stamp as securityStamp,
          created_at as createdAt,
          disabled_at as disabledAt
        FROM users
        WHERE email_normalized = ?
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
          id,
          email,
          email_normalized as emailNormalized,
          display_name as displayName,
          kdf_algorithm as kdfAlgorithm,
          kdf_iterations as kdfIterations,
          kdf_memory as kdfMemory,
          kdf_parallelism as kdfParallelism,
          master_password_hash as masterPasswordHash,
          user_key as userKey,
          private_key as privateKey,
          security_stamp as securityStamp,
          created_at as createdAt,
          disabled_at as disabledAt
        FROM users
        WHERE id = ?
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
          u.private_key as privateKey,
          u.security_stamp as securityStamp,
          u.created_at as createdAt,
          u.disabled_at as disabledAt
        FROM refresh_tokens rt
        INNER JOIN users u ON u.id = rt.user_id
        INNER JOIN devices d ON d.id = rt.device_id
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
      privateKey: row.privateKey,
      securityStamp: row.securityStamp,
      createdAt: row.createdAt,
      disabledAt: row.disabledAt,
    },
  }
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
    privateKey: row.privateKey,
    securityStamp: row.securityStamp,
    createdAt: row.createdAt,
    disabledAt: row.disabledAt,
  }
}
