import { describe, expect, it } from 'vitest'

import {
  buildDeviceId,
  createPasswordGrantSession,
  countRecentFailedAuthAttempts,
  findAuthFailureBucket,
  findAuthUserByEmail,
  findAuthUserById,
  findRefreshTokenSessionByHash,
  invalidateRefreshTokenSession,
  cleanupAuthDefenseState,
  recordAuthAttempt,
  recordFailedAuthBucket,
  recordFailedLogin,
  resetAuthFailureBucket,
  resetLoginDefenseState,
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
      publicKey: 'synthetic-public-key',
      privateKey: '2.synthetic-private-key',
      securityStamp: 'security-stamp',
      revisionDate: '2026-07-06T00:00:00.000Z',
      createdAt: '2026-07-06T00:00:00.000Z',
      disabledAt: null,
      loginFailedCount: 0,
      loginFailedAt: null,
      loginLockedUntil: null,
      totpEnabled: false,
      totpEncryptedSecret: null,
      totpLastAcceptedStep: null,
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
      publicKey: 'synthetic-public-key',
      privateKey: '2.synthetic-private-key',
      securityStamp: 'security-stamp',
      revisionDate: '2026-07-06T00:00:00.000Z',
      createdAt: '2026-07-06T00:00:00.000Z',
      disabledAt: null,
      loginFailedCount: 0,
      loginFailedAt: null,
      loginLockedUntil: null,
      totpEnabled: false,
      totpEncryptedSecret: null,
      totpLastAcceptedStep: null,
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
      publicKey: 'synthetic-public-key',
      privateKey: '2.synthetic-private-key',
      securityStamp: 'security-stamp',
      revisionDate: '2026-07-06T00:00:00.000Z',
      createdAt: '2026-07-06T00:00:00.000Z',
      disabledAt: null,
      loginFailedCount: 0,
      loginFailedAt: null,
      loginLockedUntil: null,
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
      publicKey: 'synthetic-public-key',
      privateKey: '2.synthetic-private-key',
      securityStamp: 'security-stamp',
      revisionDate: '2026-07-06T00:00:00.000Z',
      createdAt: '2026-07-06T00:00:00.000Z',
      disabledAt: null,
      loginFailedCount: 0,
      loginFailedAt: null,
      loginLockedUntil: null,
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

  it('records a failed login state for an existing user', async () => {
    const database = new RecordingAuthD1Database(null)

    await recordFailedLogin(database, {
      userId: 'user-id',
      failedCount: 5,
      failedAt: '2026-07-06T00:05:00.000Z',
      lockedUntil: '2026-07-06T00:20:00.000Z',
    })

    expect(database.queries.join('\n')).toContain('UPDATE users')
    expect(database.queries.join('\n')).toContain('login_failed_count')
    expect(database.boundValues).toContain(5)
    expect(database.boundValues).toContain('2026-07-06T00:20:00.000Z')
  })

  it('resets login defense state after a successful password grant', async () => {
    const database = new RecordingAuthD1Database(null)

    await resetLoginDefenseState(database, {
      userId: 'user-id',
      resetAt: '2026-07-06T00:06:00.000Z',
    })

    expect(database.queries.join('\n')).toContain('UPDATE users')
    expect(database.queries.join('\n')).toContain('login_failed_count = 0')
    expect(database.queries.join('\n')).toContain('login_locked_until = NULL')
    expect(database.boundValues).toContain('user-id')
  })

  it('records auth attempts without plaintext network source values', async () => {
    const database = new RecordingAuthD1Database(null)

    await recordAuthAttempt(database, {
      id: 'attempt-id',
      bucketKey: 'ip:hashed-bucket',
      subjectKey: 'account:hashed-subject',
      successful: false,
      occurredAt: '2026-07-06T00:05:00.000Z',
    })

    expect(database.queries.join('\n')).toContain('INSERT INTO auth_attempts')
    expect(database.boundValues).toContain('ip:hashed-bucket')
    expect(database.boundValues).not.toContain('203.0.113.10')
  })

  it('counts recent failed auth attempts for a bucket', async () => {
    const database = new RecordingAuthD1Database(null, null, 1, 1, 12)

    await expect(
      countRecentFailedAuthAttempts(database, {
        bucketKey: 'ip:hashed-bucket',
        occurredAfter: '2026-07-06T00:00:00.000Z',
      }),
    ).resolves.toBe(12)

    expect(database.queries.join('\n')).toContain('COUNT(*) as count')
    expect(database.boundValues).toContain('ip:hashed-bucket')
  })

  it('looks up a failed auth bucket by hashed key', async () => {
    const database = new RecordingAuthD1Database(null, null, 1, 1, 0, {
      bucketKey: 'account:hashed-bucket',
      failedCount: 4,
      windowStartedAt: '2026-07-06T00:00:00.000Z',
      lockedUntil: null,
      updatedAt: '2026-07-06T00:04:00.000Z',
    })

    await expect(
      findAuthFailureBucket(database, 'account:hashed-bucket'),
    ).resolves.toEqual({
      bucketKey: 'account:hashed-bucket',
      failedCount: 4,
      windowStartedAt: '2026-07-06T00:00:00.000Z',
      lockedUntil: null,
      updatedAt: '2026-07-06T00:04:00.000Z',
    })
    expect(database.queries.join('\n')).toContain('FROM auth_failure_buckets')
    expect(database.boundValues).toContain('account:hashed-bucket')
  })

  it('atomically advances failed auth buckets in the database', async () => {
    const database = new RecordingAuthD1Database(null)

    await expect(
      recordFailedAuthBucket(database, {
        bucketKey: 'ip:hashed-bucket',
        failureLimit: 20,
        failureWindowSeconds: 60,
        lockoutSeconds: 60,
        now: '2026-07-06T00:05:00.000Z',
      }),
    ).resolves.toEqual({
      bucketKey: 'ip:hashed-bucket',
      failedCount: 1,
      windowStartedAt: '2026-07-06T00:05:00.000Z',
      lockedUntil: null,
      updatedAt: '2026-07-06T00:05:00.000Z',
    })

    const joinedQueries = database.queries.join('\n')
    expect(joinedQueries).toContain('INSERT INTO auth_failure_buckets')
    expect(joinedQueries).toContain('ON CONFLICT(bucket_key) DO UPDATE')
    expect(joinedQueries).toContain('auth_failure_buckets.failed_count + 1')
    expect(database.boundValues).toContain('ip:hashed-bucket')
    expect(database.boundValues).toContain(20)
  })

  it('resets a failed auth bucket after successful authentication', async () => {
    const database = new RecordingAuthD1Database(null)

    await resetAuthFailureBucket(database, 'account:hashed-bucket')

    expect(database.queries.join('\n')).toContain(
      'DELETE FROM auth_failure_buckets',
    )
    expect(database.boundValues).toContain('account:hashed-bucket')
  })

  it('cleans up stale auth-defense rows in bounded, idempotent slices', async () => {
    const database = new CleanupAwareAuthD1Database(3, 2)
    const cleanupInput = {
      now: '2026-07-06T00:10:00.000Z',
      authAttemptExpiredBefore: '2026-07-06T00:00:00.000Z',
      authFailureBucketExpiredBefore: '2026-07-06T00:00:00.000Z',
      maxRowsPerQuery: 5,
    }

    await expect(
      cleanupAuthDefenseState(database, cleanupInput),
    ).resolves.toEqual({
      deletedAuthAttempts: 3,
      deletedAuthFailureBuckets: 2,
    })
    await expect(
      cleanupAuthDefenseState(database, cleanupInput),
    ).resolves.toEqual({
      deletedAuthAttempts: 0,
      deletedAuthFailureBuckets: 0,
    })

    const query = database.queries.join('\n')
    expect(query).toContain('DELETE FROM auth_attempts')
    expect(query).toContain('DELETE FROM auth_failure_buckets')
    expect(query).toContain('ORDER BY occurred_at ASC')
    expect(query).toContain('ORDER BY updated_at ASC')
    expect(query).toContain('LIMIT ?')
    expect(database.boundValues).toContain('2026-07-06T00:00:00.000Z')
    expect(database.boundValues).toContain(5)
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

class CleanupAwareAuthD1Database {
  boundValues: unknown[] = []
  queries: string[] = []

  private remainingAuthAttemptDeletes: number
  private remainingAuthFailureBucketDeletes: number

  constructor(
    initialAuthAttemptDeletes = 1,
    initialAuthFailureBucketDeletes = 1,
  ) {
    this.remainingAuthAttemptDeletes = initialAuthAttemptDeletes
    this.remainingAuthFailureBucketDeletes = initialAuthFailureBucketDeletes
  }

  prepare(query: string): D1PreparedStatement {
    this.queries.push(query)
    const thisBoundValues = this.boundValues
    const thisRemainingAuthAttemptDeletes = () => {
      const value = this.remainingAuthAttemptDeletes
      this.remainingAuthAttemptDeletes = 0

      return value
    }
    const thisRemainingAuthFailureBucketDeletes = () => {
      const value = this.remainingAuthFailureBucketDeletes
      this.remainingAuthFailureBucketDeletes = 0

      return value
    }

    const run = async <T = Record<string, unknown>>(): Promise<D1Result<T>> => {
      let changes = fakeMeta.changes

      if (/DELETE\s+FROM\s+auth_attempts/.test(query)) {
        changes = thisRemainingAuthAttemptDeletes()
      }

      if (/DELETE\s+FROM\s+auth_failure_buckets/.test(query)) {
        changes = thisRemainingAuthFailureBucketDeletes()
      }

      return {
        success: true,
        results: [],
        meta: {
          ...fakeMeta,
          changes,
        },
      }
    }

    const bind = (...values: unknown[]) => {
      thisBoundValues.push(...values)
      return statement
    }

    const statement = {
      bind,
      first: async <T = unknown>(): Promise<T | null> => null,
      all: async <T = unknown>(): Promise<D1Result<T>> => ({
        success: true,
        results: [],
        meta: fakeMeta,
      }),
      run,
      raw: async <T = unknown>(): Promise<T[]> => [],
    } as D1PreparedStatement

    return statement
  }
}

class RecordingAuthD1Database {
  boundValues: unknown[] = []
  batchStatements: D1PreparedStatement[] = []
  queries: string[] = []
  private authFailureBucketRow: unknown

  constructor(
    private readonly userRow: unknown,
    private readonly refreshSessionRow: unknown = null,
    private readonly updateChanges = 1,
    private readonly deviceUpdateChanges = 1,
    private readonly failedAttemptCount = 0,
    authFailureBucketRow: unknown = null,
  ) {
    this.authFailureBucketRow = authFailureBucketRow
  }

  prepare(query: string): D1PreparedStatement {
    this.queries.push(query)
    let statementBoundValues: unknown[] = []
    const pushValues = (values: unknown[]) => {
      this.boundValues.push(...values)
      statementBoundValues = values
    }
    const getUserRow = () => this.userRow
    const getRefreshSessionRow = () => this.refreshSessionRow
    const getUpdateChanges = () => this.updateChanges
    const getDeviceUpdateChanges = () => this.deviceUpdateChanges
    const getFailedAttemptCount = () => this.failedAttemptCount
    const getAuthFailureBucketRow = () => this.authFailureBucketRow
    const setAuthFailureBucketRow = (row: unknown) => {
      this.authFailureBucketRow = row
    }

    const statement = {
      bind(...values: unknown[]) {
        pushValues(values)
        return statement
      },
      async first<T = unknown>(): Promise<T | null> {
        if (query.includes('FROM auth_failure_buckets')) {
          return getAuthFailureBucketRow() as T | null
        }

        if (query.includes('COUNT(*) as count')) {
          return {
            count: getFailedAttemptCount(),
          } as T
        }

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
        if (query.includes('INSERT INTO auth_failure_buckets')) {
          setAuthFailureBucketRow({
            bucketKey: statementBoundValues[0],
            failedCount: 1,
            windowStartedAt: statementBoundValues[1],
            lockedUntil: statementBoundValues[2],
            updatedAt: statementBoundValues[3],
          })
        }

        if (/DELETE\s+FROM\s+auth_failure_buckets/.test(query)) {
          setAuthFailureBucketRow(null)
        }

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
