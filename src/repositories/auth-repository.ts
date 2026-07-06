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
          disabled_at as disabledAt
        FROM users
        WHERE email_normalized = ?
        LIMIT 1
      `,
    )
    .bind(emailNormalized)
    .first<AuthUserRow>()

  return row ?? null
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

export function buildDeviceId(
  userId: string,
  deviceIdentifier: string,
): string {
  return `${userId}:${deviceIdentifier}`
}
