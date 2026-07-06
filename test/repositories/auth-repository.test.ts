import { describe, expect, it } from 'vitest'

import {
  buildDeviceId,
  createPasswordGrantSession,
  findAuthUserByEmail,
  findAuthUserById,
  findRefreshTokenSessionByHash,
  invalidateRefreshTokenSession,
  revokeDeviceSession,
  rotateRefreshToken,
} from '../../src/repositories/auth-repository'

const fakeMeta = {
  duration: 0,
  size_after: 0,
  rows_read: 1,
  rows_written: 1,
  last_row_id: 1,
  changed_db: true,
  changes: 1,
} satisfies D1Meta & Record<string, unknown>

describe('auth repository', () => {
  it('looks up auth users by normalized email', async () => {
    const database = new RecordingAuthD1Database({
      id: 'user-id',
      email: 'Person@Example.Test',
      emailNormalized: 'person@example.test',
      displayName: 'Person',
      kdfAlgorithm: 'pbkdf2-sha256',
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
      masterPasswordHash: 'synthetic-master-password-hash',
      userKey: '2.synthetic-user-key',
      privateKey: null,
      securityStamp: 'security-stamp',
      createdAt: '2026-07-06T00:00:00.000Z',
      disabledAt: null,
    })

    await expect(
      findAuthUserByEmail(database, 'person@example.test'),
    ).resolves.toEqual({
      id: 'user-id',
      email: 'Person@Example.Test',
      emailNormalized: 'person@example.test',
      displayName: 'Person',
      kdfAlgorithm: 'pbkdf2-sha256',
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
      masterPasswordHash: 'synthetic-master-password-hash',
      userKey: '2.synthetic-user-key',
      privateKey: null,
      securityStamp: 'security-stamp',
      createdAt: '2026-07-06T00:00:00.000Z',
      disabledAt: null,
    })
    expect(database.boundValues).toContain('person@example.test')
  })

  it('looks up auth users by ID for authenticated API reads', async () => {
    const database = new RecordingAuthD1Database({
      id: 'user-id',
      email: 'Person@Example.Test',
      emailNormalized: 'person@example.test',
      displayName: 'Person',
      kdfAlgorithm: 'pbkdf2-sha256',
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
      masterPasswordHash: 'synthetic-master-password-hash',
      userKey: '2.synthetic-user-key',
      privateKey: null,
      securityStamp: 'security-stamp',
      createdAt: '2026-07-06T00:00:00.000Z',
      disabledAt: null,
    })

    await expect(findAuthUserById(database, 'user-id')).resolves.toMatchObject({
      id: 'user-id',
      emailNormalized: 'person@example.test',
      createdAt: '2026-07-06T00:00:00.000Z',
    })
    expect(database.boundValues).toContain('user-id')
  })

  it('upserts a device and stores only the refresh token hash', async () => {
    const database = new RecordingAuthD1Database(null)

    await createPasswordGrantSession(database, {
      userId: 'user-id',
      deviceIdentifier: 'device-identifier',
      deviceName: 'Desktop',
      deviceType: 9,
      refreshTokenId: 'refresh-token-id',
      refreshTokenHash: 'hashed-refresh-token',
      refreshTokenExpiresAt: '2026-08-05T00:00:00.000Z',
      now: '2026-07-06T00:00:00.000Z',
    })

    expect(database.batchStatements).toHaveLength(3)
    expect(database.boundValues).toContain(
      buildDeviceId('user-id', 'device-identifier'),
    )
    expect(database.boundValues).toContain('hashed-refresh-token')
    expect(database.boundValues).not.toContain('plaintext-refresh-token')
  })

  it('finds refresh token sessions with user and device context', async () => {
    const database = new RecordingAuthD1Database(null, {
      tokenId: 'refresh-token-id',
      userId: 'user-id',
      deviceId: 'device-id',
      deviceIdentifier: 'device-identifier',
      tokenExpiresAt: '2026-08-05T00:00:00.000Z',
      tokenRevokedAt: null,
      deviceRevokedAt: null,
      email: 'Person@Example.Test',
      emailNormalized: 'person@example.test',
      displayName: 'Person',
      kdfAlgorithm: 'pbkdf2-sha256',
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
      masterPasswordHash: 'synthetic-master-password-hash',
      userKey: '2.synthetic-user-key',
      privateKey: null,
      securityStamp: 'security-stamp',
      createdAt: '2026-07-06T00:00:00.000Z',
      disabledAt: null,
    })

    await expect(
      findRefreshTokenSessionByHash(database, 'hashed-refresh-token'),
    ).resolves.toMatchObject({
      tokenId: 'refresh-token-id',
      userId: 'user-id',
      deviceId: 'device-id',
      deviceIdentifier: 'device-identifier',
      user: {
        emailNormalized: 'person@example.test',
      },
    })
    expect(database.boundValues).toContain('hashed-refresh-token')
  })

  it('rotates refresh token hashes after conditionally revoking the old token', async () => {
    const database = new RecordingAuthD1Database(null, null, 1)

    await expect(
      rotateRefreshToken(database, {
        currentTokenId: 'current-refresh-token-id',
        userId: 'user-id',
        deviceId: 'device-id',
        deviceIdentifier: 'device-identifier',
        deviceName: 'Desktop',
        deviceType: 9,
        nextRefreshTokenId: 'next-refresh-token-id',
        nextRefreshTokenHash: 'next-refresh-token-hash',
        nextRefreshTokenExpiresAt: '2026-08-05T00:00:00.000Z',
        now: '2026-07-06T00:00:00.000Z',
      }),
    ).resolves.toEqual({
      status: 'rotated',
    })

    expect(database.boundValues).toContain('current-refresh-token-id')
    expect(database.boundValues).toContain('next-refresh-token-hash')
    expect(database.boundValues).not.toContain('next-refresh-token-plaintext')
    expect(database.batchStatements).toHaveLength(2)
  })

  it('invalidates the device session when rotation detects reuse', async () => {
    const database = new RecordingAuthD1Database(null, null, 0)

    await expect(
      rotateRefreshToken(database, {
        currentTokenId: 'current-refresh-token-id',
        userId: 'user-id',
        deviceId: 'device-id',
        deviceIdentifier: 'device-identifier',
        deviceName: 'Desktop',
        deviceType: 9,
        nextRefreshTokenId: 'next-refresh-token-id',
        nextRefreshTokenHash: 'next-refresh-token-hash',
        nextRefreshTokenExpiresAt: '2026-08-05T00:00:00.000Z',
        now: '2026-07-06T00:00:00.000Z',
      }),
    ).resolves.toEqual({
      status: 'reuse_detected',
    })

    expect(database.batchStatements).toHaveLength(2)
    expect(database.boundValues).toContain('device-id')
    expect(database.boundValues).not.toContain('next-refresh-token-hash')
  })

  it('can invalidate active refresh tokens for one device session', async () => {
    const database = new RecordingAuthD1Database(null)

    await invalidateRefreshTokenSession(
      database,
      'user-id',
      'device-id',
      '2026-07-06T00:00:00.000Z',
    )

    expect(database.batchStatements).toHaveLength(2)
    expect(database.boundValues).toContain('user-id')
    expect(database.boundValues).toContain('device-id')
  })

  it('revokes an active owner-scoped device session', async () => {
    const database = new RecordingAuthD1Database(null, null, 1, 1)

    await expect(
      revokeDeviceSession(database, {
        userId: 'user-id',
        deviceId: 'target-device-id',
        revokedAt: '2026-07-06T00:10:00.000Z',
      }),
    ).resolves.toEqual({
      status: 'revoked',
      deviceId: 'target-device-id',
      revokedAt: '2026-07-06T00:10:00.000Z',
    })

    expect(database.boundValues).toContain('user-id')
    expect(database.boundValues).toContain('target-device-id')
    expect(database.queries.join('\n')).toContain('UPDATE devices')
    expect(database.queries.join('\n')).toContain('revoked_at = ?')
    expect(database.queries.join('\n')).toContain('UPDATE refresh_tokens')
  })

  it('returns not found when revoking a missing, cross-user, or already revoked device', async () => {
    const database = new RecordingAuthD1Database(null, null, 1, 0)

    await expect(
      revokeDeviceSession(database, {
        userId: 'user-id',
        deviceId: 'target-device-id',
        revokedAt: '2026-07-06T00:10:00.000Z',
      }),
    ).resolves.toEqual({
      status: 'not_found',
    })

    expect(database.queries.join('\n')).toContain('UPDATE devices')
    expect(database.queries.join('\n')).not.toContain('UPDATE refresh_tokens')
  })
})

class RecordingAuthD1Database {
  boundValues: unknown[] = []
  batchStatements: D1PreparedStatement[] = []
  queries: string[] = []

  constructor(
    private readonly userRow: unknown,
    private readonly refreshSessionRow: unknown = null,
    private readonly updateChanges = 1,
    private readonly deviceUpdateChanges = 1,
  ) {}

  prepare(query: string): D1PreparedStatement {
    this.queries.push(query)
    const pushValues = (values: unknown[]) => {
      this.boundValues.push(...values)
    }
    const getUserRow = () => this.userRow
    const getRefreshSessionRow = () => this.refreshSessionRow
    const getUpdateChanges = () => this.updateChanges
    const getDeviceUpdateChanges = () => this.deviceUpdateChanges

    const statement = {
      bind(...values: unknown[]) {
        pushValues(values)
        return statement
      },
      async first<T = unknown>(): Promise<T | null> {
        if (query.includes('FROM refresh_tokens')) {
          return getRefreshSessionRow() as T | null
        }

        if (query.includes('FROM users')) {
          return getUserRow() as T | null
        }

        return null
      },
      async all<T = unknown>(): Promise<D1Result<T>> {
        return {
          success: true,
          results: [],
          meta: fakeMeta,
        }
      },
      async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        const changes =
          /UPDATE\s+devices/.test(query) && query.includes('revoked_at = ?')
            ? getDeviceUpdateChanges()
            : /UPDATE\s+refresh_tokens/.test(query)
              ? getUpdateChanges()
              : fakeMeta.changes

        return {
          success: true,
          results: [],
          meta: {
            ...fakeMeta,
            changes,
          },
        }
      },
      async raw<T = unknown>(): Promise<T[]> {
        return []
      },
    } as D1PreparedStatement

    return statement
  }

  async batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    this.batchStatements = statements

    return statements.map(() => ({
      success: true,
      results: [],
      meta: fakeMeta,
    }))
  }
}
