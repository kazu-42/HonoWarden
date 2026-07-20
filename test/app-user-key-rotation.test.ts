import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import app from '../src/app'
import { signAccessToken } from '../src/domain/tokens'
import { userKeyRotationPolicy } from '../src/domain/user-key-rotation'
import { userKeyRotationRepositoryPolicy } from '../src/repositories/user-key-rotation-repository'
import { FakeD1Database } from './support/fake-d1'

const route = '/api/accounts/key-management/rotate-user-account-keys'
const pinnedFixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        '../.workflow/hon-206-user-key-rotation/fixtures/pinned-v1-empty-vault.json',
        import.meta.url,
      ).toString(),
    ),
    'utf8',
  ),
) as {
  source: {
    serverTag: string
    serverCommit: string
    webTag: string
    webCommit: string
  }
  request: { body: Record<string, unknown> }
}

describe('user-key rotation route', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns D1-free 501 for disabled POST and HEAD even with global quota enabled', async () => {
    for (const method of ['POST', 'HEAD'] as const) {
      const database = new ExplodingD1Database()
      const response = await app.request(
        route,
        {
          method,
          headers: { 'Content-Type': 'application/json' },
          ...(method === 'POST' ? { body: '{}' } : {}),
        },
        {
          DB: database as unknown as D1Database,
          HONOWARDEN_GLOBAL_REQUEST_QUOTA: 'true',
        },
      )

      expect(response.status).toBe(501)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      if (method === 'HEAD') {
        await expect(response.text()).resolves.toBe('')
      } else {
        await expect(response.json()).resolves.toMatchObject({
          error: {
            code: 'unsupported_feature',
            message: 'User-key rotation is not activated on this server.',
          },
        })
      }
      expect(database.calls).toBe(0)
    }
  })

  it('rejects malformed input before proof-defense or rotation queries', async () => {
    const database = new RotationRouteD1Database('success')
    const response = await rotateRequest(database, {})

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'invalid_request' },
    })
    expect(
      database.queries.some((query) => query.includes('auth_failure_buckets')),
    ).toBe(false)
    expect(database.batchCalls).toBe(0)
  })

  it('rejects an oversized raw JSON body before proof-defense or rotation queries', async () => {
    const database = new RotationRouteD1Database('success')
    const response = await app.request(
      route,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await accessTokenFor(database.user)}`,
          'Content-Type': 'application/json',
        },
        body: `${' '.repeat(
          userKeyRotationPolicy.requestJsonMaxLength + 1,
        )}${JSON.stringify(rotationBody())}`,
      },
      enabledEnvironment(database),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'invalid_request' },
    })
    expect(
      database.queries.some((query) => query.includes('auth_failure_buckets')),
    ).toBe(false)
    expect(database.batchCalls).toBe(0)
  })

  it('uses the existing credential-proof defense for an invalid old hash', async () => {
    const user = routeUser()
    const database = new FakeD1Database(null, [], { authUser: user })
    const batch = vi.spyOn(database, 'batch')
    const response = await app.request(
      route,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await accessTokenFor(user)}`,
          'CF-Connecting-IP': '203.0.113.87',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...rotationBody(),
          oldMasterKeyAuthenticationHash: 'wrong-authentication-hash',
        }),
      },
      enabledEnvironment(database),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
        message: 'The supplied credentials are invalid.',
      },
    })
    expect(batch).not.toHaveBeenCalled()
    expect(user).toEqual(routeUser())
  })

  it('rejects a missing notification binding before proof-defense queries', async () => {
    const database = new RotationRouteD1Database('success')
    const response = await rotateRequest(database, rotationBody(), {
      HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED: 'true',
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'server_misconfigured' },
    })
    expect(
      database.queries.some((query) => query.includes('auth_failure_buckets')),
    ).toBe(false)
    expect(database.batchCalls).toBe(0)
  })

  it.each([
    ['not_found', 409, 'user_key_rotation_conflict', 0],
    ['conflict', 409, 'user_key_rotation_conflict', 1],
    ['unsupported', 409, 'user_key_rotation_unsupported', 0],
    ['over_budget', 413, 'user_key_rotation_over_budget', 0],
    ['failure', 503, 'database_unavailable', 1],
  ] as const)(
    'maps repository %s without disclosing opaque generation values',
    async (mode, expectedStatus, expectedCode, expectedBatchCalls) => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const database = new RotationRouteD1Database(mode)
      const response = await rotateRequest(database, rotationBody())

      expect(response.status).toBe(expectedStatus)
      const responseBody = await response.json()
      expect(responseBody).toMatchObject({ error: { code: expectedCode } })
      const serialized = JSON.stringify(responseBody)
      expect(serialized).not.toContain('synthetic-current-auth-hash')
      expect(serialized).not.toContain('synthetic-next-auth-hash')
      expect(serialized).not.toContain('synthetic-next-wrapped-user-key')
      expect(serialized).not.toContain('synthetic-next-wrapped-private-key')
      expect(database.batchCalls).toBe(expectedBatchCalls)
    },
  )

  it('commits once, invalidates the old token, and projects one new generation', async () => {
    const database = new RotationRouteD1Database('success')
    const initialLogin = await passwordGrantRequest(
      database,
      'synthetic-current-auth-hash',
    )
    expect(initialLogin.status).toBe(200)
    const initialTokens = (await initialLogin.json()) as {
      access_token: string
      refresh_token: string
    }
    const response = await rotateRequest(
      database,
      rotationBody(),
      {},
      initialTokens.access_token,
    )

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('')
    expect(database.batchCalls).toBe(1)
    expect(database.user).toMatchObject({
      masterPasswordHash: 'synthetic-next-auth-hash',
      userKey: '2.synthetic-next-wrapped-user-key',
      publicKey: 'synthetic-account-public-key',
      privateKey: '2.synthetic-next-wrapped-private-key',
      securityStamp: expect.not.stringMatching(/^security-stamp$/),
      revisionDate: expect.not.stringMatching(/^2026-07-06T00:00:00\.000Z$/),
    })
    expect(database.auditValues?.[2]).toBe('account.keys.rotate')
    expect(database.auditValues?.[3]).toBe('success')
    const auditJson = JSON.stringify(database.auditValues)
    expect(auditJson).not.toContain('synthetic-next-auth-hash')
    expect(auditJson).not.toContain('synthetic-next-wrapped-user-key')
    expect(auditJson).not.toContain('synthetic-next-wrapped-private-key')

    const oldProfile = await app.request(
      '/api/accounts/profile',
      {
        headers: {
          Authorization: `Bearer ${initialTokens.access_token}`,
        },
      },
      enabledEnvironment(database),
    )
    expect(oldProfile.status).toBe(401)
    await expect(oldProfile.json()).resolves.toMatchObject({
      error: { code: 'invalid_token' },
    })

    const oldRefresh = await refreshGrantRequest(
      database,
      initialTokens.refresh_token,
    )
    expect(oldRefresh.status).toBe(400)

    const oldPasswordLogin = await passwordGrantRequest(
      database,
      'synthetic-current-auth-hash',
    )
    expect(oldPasswordLogin.status).toBe(400)

    const nextLogin = await passwordGrantRequest(
      database,
      'synthetic-next-auth-hash',
    )
    expect(nextLogin.status, await nextLogin.clone().text()).toBe(200)
    const nextTokens = (await nextLogin.json()) as {
      access_token: string
      refresh_token: string
      Key: string
      PrivateKey: string
      AccountKeys: {
        publicKeyEncryptionKeyPair: {
          publicKey: string
          wrappedPrivateKey: string
        }
      }
    }
    expect(nextTokens).toMatchObject({
      Key: '2.synthetic-next-wrapped-user-key',
      PrivateKey: '2.synthetic-next-wrapped-private-key',
      AccountKeys: {
        publicKeyEncryptionKeyPair: {
          publicKey: 'synthetic-account-public-key',
          wrappedPrivateKey: '2.synthetic-next-wrapped-private-key',
        },
      },
    })

    const profile = await app.request(
      '/api/accounts/profile',
      { headers: { Authorization: `Bearer ${nextTokens.access_token}` } },
      enabledEnvironment(database),
    )
    expect(profile.status).toBe(200)
    await expect(profile.json()).resolves.toMatchObject({
      key: '2.synthetic-next-wrapped-user-key',
      privateKey: '2.synthetic-next-wrapped-private-key',
      accountKeys: {
        publicKeyEncryptionKeyPair: {
          publicKey: 'synthetic-account-public-key',
          wrappedPrivateKey: '2.synthetic-next-wrapped-private-key',
        },
      },
    })

    const sync = await app.request(
      '/api/sync',
      { headers: { Authorization: `Bearer ${nextTokens.access_token}` } },
      enabledEnvironment(database),
    )
    expect(sync.status).toBe(200)
    await expect(sync.json()).resolves.toMatchObject({
      profile: {
        key: '2.synthetic-next-wrapped-user-key',
        privateKey: '2.synthetic-next-wrapped-private-key',
        accountKeys: {
          publicKeyEncryptionKeyPair: {
            publicKey: 'synthetic-account-public-key',
            wrappedPrivateKey: '2.synthetic-next-wrapped-private-key',
          },
        },
      },
      folders: [],
      ciphers: [],
    })

    const backup = await app.request(
      '/api/accounts/export',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${nextTokens.access_token}`,
        },
      },
      enabledEnvironment(database),
    )
    expect(backup.status).toBe(200)
    await expect(backup.json()).resolves.toMatchObject({
      account: {
        key: '2.synthetic-next-wrapped-user-key',
        publicKey: 'synthetic-account-public-key',
        privateKey: '2.synthetic-next-wrapped-private-key',
      },
      folders: [],
      ciphers: [],
      attachments: [],
    })
  })

  it('replays the pinned V1 empty-vault request fixture without promoting live compatibility', async () => {
    expect(pinnedFixture.source).toEqual({
      serverTag: 'v2026.6.1',
      serverCommit: 'a09c7edb03ae6d4fdece784f1250c67be73d5fe0',
      webTag: 'web-v2026.6.1',
      webCommit: '39f07436ca60e3f25eac47777671754f288a98f1',
    })
    const database = new RotationRouteD1Database('success')

    const response = await rotateRequest(database, rotationBody())

    expect(response.status).toBe(200)
    expect(database.batchCalls).toBe(1)
  })

  it('acknowledges committed D1 state before best-effort notification cleanup', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const database = new RotationRouteD1Database('success')
    const notificationFetch = vi
      .fn()
      .mockRejectedValue(new Error('notification hub unavailable'))
    const response = await rotateRequest(database, rotationBody(), {
      HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED: 'true',
      NOTIFICATION_HUB: {
        idFromName: () => 'user-object',
        get: () => ({ fetch: notificationFetch }),
      } as unknown as DurableObjectNamespace,
    })

    expect(response.status).toBe(200)
    expect(database.batchCalls).toBe(1)
    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining(
          'account_notification_session_invalidation_failed',
        ),
      )
    })
  })
})

type RotationMode =
  | 'success'
  | 'not_found'
  | 'conflict'
  | 'unsupported'
  | 'over_budget'
  | 'failure'

type RouteUser = ReturnType<typeof routeUser>

class RotationRouteD1Database {
  readonly user = routeUser()
  readonly queries: string[] = []
  readonly authFailureBuckets = new Map<
    string,
    {
      bucketKey: string
      failedCount: number
      windowStartedAt: string
      lockedUntil: string | null
      updatedAt: string
    }
  >()
  readonly refreshSessions: Array<{
    tokenId: string
    userId: string
    deviceId: string
    deviceIdentifier: string
    tokenHash: string
    tokenExpiresAt: string
    tokenRevokedAt: string | null
    deviceRevokedAt: string | null
  }> = []
  batchCalls = 0
  auditValues: unknown[] | null = null

  constructor(private readonly mode: RotationMode) {}

  prepare(query: string): D1PreparedStatement {
    this.queries.push(query)
    let values: unknown[] = []
    const statement = {
      get query() {
        return query
      },
      get values() {
        return values
      },
      bind: (...nextValues: unknown[]) => {
        values = nextValues
        return statement
      },
      first: async <T = Record<string, unknown>>() => {
        if (query.includes('auth_failure_buckets')) {
          return (this.authFailureBuckets.get(String(values[0])) ?? null) as T
        }
        if (query.includes('FROM refresh_tokens')) {
          const session = this.refreshSessions.find(
            (candidate) => candidate.tokenHash === values[0],
          )
          return session ? ({ ...session, ...this.user } as T) : null
        }
        if (query.includes('as activeFolderCount')) {
          if (this.mode === 'not_found') {
            return null
          }
          return {
            ...this.user,
            activeFolderCount: 0,
            deletedFolderCount: 0,
            folderBytes: 0,
            activeCipherCount: 0,
            deletedCipherCount: this.mode === 'unsupported' ? 1 : 0,
            personalCipherKeyCount: 0,
            cipherBytes:
              this.mode === 'over_budget'
                ? userKeyRotationRepositoryPolicy.maxSnapshotCipherBytes + 1
                : 0,
            uploadedAttachmentCount: 0,
            pendingAttachmentCount: 0,
            attachmentBytes: 0,
            trustedDeviceCount: 0,
            incompleteTrustedDeviceCount: 0,
            revokedDeviceKeyCount: 0,
            trustedDeviceBytes: 0,
          } as T
        }
        if (query.includes('SUM(size)')) {
          return { storageBytes: 0 } as T
        }
        if (query.includes('FROM users')) {
          return this.user as T
        }
        return null
      },
      all: async <T = Record<string, unknown>>() => ({
        success: true as const,
        results: [] as T[],
        meta: d1Meta(0),
      }),
      run: async <T = Record<string, unknown>>() => {
        if (query.includes('INSERT INTO auth_failure_buckets')) {
          const bucketKey = String(values[0])
          const now = String(values[1])
          const firstFailureLockedUntil = values[2] as string | null
          const windowThreshold = String(values[4])
          const failureLimit = Number(values[7])
          const failureLockedUntil = String(values[8])
          const existing = this.authFailureBuckets.get(bucketKey)
          const insideWindow =
            existing !== undefined &&
            existing.windowStartedAt >= windowThreshold
          const failedCount = insideWindow ? existing.failedCount + 1 : 1

          this.authFailureBuckets.set(bucketKey, {
            bucketKey,
            failedCount,
            windowStartedAt: insideWindow ? existing.windowStartedAt : now,
            lockedUntil:
              failedCount >= failureLimit
                ? failureLockedUntil
                : firstFailureLockedUntil,
            updatedAt: now,
          })
        } else if (/DELETE\s+FROM\s+auth_failure_buckets/.test(query)) {
          this.authFailureBuckets.delete(String(values[0]))
        }

        return {
          success: true as const,
          results: [] as T[],
          meta: d1Meta(1),
        }
      },
      raw: async <T = unknown>() => [] as T[],
    }

    return statement as unknown as D1PreparedStatement
  }

  async batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    const recorded = statements as unknown as Array<{
      query: string
      values: unknown[]
    }>
    if (
      recorded.length === 3 &&
      recorded[0]?.query.includes('INSERT OR IGNORE INTO devices') &&
      recorded[2]?.query.includes('INSERT INTO refresh_tokens')
    ) {
      const deviceValues = recorded[0].values
      const refreshValues = recorded[2].values
      this.refreshSessions.push({
        tokenId: String(refreshValues[0]),
        userId: String(refreshValues[1]),
        deviceId: String(refreshValues[2]),
        deviceIdentifier: String(deviceValues[2]),
        tokenHash: String(refreshValues[3]),
        tokenExpiresAt: String(refreshValues[4]),
        tokenRevokedAt: null,
        deviceRevokedAt: null,
      })
      return recorded.map(() => d1Result<T>(1))
    }

    if (
      recorded.length === 2 &&
      recorded[0]?.query.includes('UPDATE refresh_tokens') &&
      recorded[1]?.query.includes('UPDATE devices')
    ) {
      const revokedAt = String(recorded[0].values[0])
      const userId = String(recorded[0].values[1])
      const deviceId = String(recorded[0].values[2])

      for (const session of this.refreshSessions) {
        if (session.userId === userId && session.deviceId === deviceId) {
          session.tokenRevokedAt ??= revokedAt
          session.deviceRevokedAt = revokedAt
        }
      }

      return recorded.map(() => d1Result<T>(1))
    }

    this.batchCalls += 1
    if (this.mode === 'failure') {
      throw new Error('synthetic D1 failure')
    }
    if (this.mode === 'conflict') {
      return recorded.map(() => d1Result<T>(0))
    }

    const userValues = recorded[0]?.values ?? []
    const activeRefreshSessions = this.refreshSessions.filter(
      (session) => session.tokenRevokedAt === null,
    )
    Object.assign(this.user, {
      masterPasswordHash: String(userValues[4]),
      userKey: String(userValues[5]),
      privateKey: String(userValues[6]),
      securityStamp: String(userValues[7]),
      revisionDate: String(userValues[8]),
    })
    for (const session of activeRefreshSessions) {
      session.tokenRevokedAt = String(userValues[8])
      session.deviceRevokedAt = String(userValues[8])
    }
    this.auditValues = recorded[9]?.values ?? null

    return recorded.map((_, index) => {
      if (index === 0) {
        return {
          ...d1Result<T>(1),
          results: [{ id: this.user.id }] as T[],
        }
      }
      if (index === 5) {
        return d1Result<T>(0)
      }
      if (index === 6) {
        return d1Result<T>(activeRefreshSessions.length > 0 ? 1 : 0)
      }
      if (index === 7) {
        return d1Result<T>(activeRefreshSessions.length)
      }
      return d1Result<T>(index === 9 ? 1 : 0)
    })
  }
}

function routeUser() {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'Person@Example.Test',
    emailNormalized: 'person@example.test',
    displayName: 'Person',
    kdfAlgorithm: 'pbkdf2-sha256',
    kdfIterations: 600_000,
    kdfMemory: null,
    kdfParallelism: null,
    masterPasswordHash: 'synthetic-current-auth-hash',
    userKey: '2.synthetic-current-wrapped-user-key',
    publicKey: 'synthetic-account-public-key',
    privateKey: '2.synthetic-current-wrapped-private-key',
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
  }
}

function rotationBody() {
  return structuredClone(pinnedFixture.request.body)
}

async function rotateRequest(
  database: RotationRouteD1Database,
  body: unknown,
  extraEnvironment: Record<string, unknown> = {},
  accessToken?: string,
) {
  return app.request(
    route,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${
          accessToken ?? (await accessTokenFor(database.user))
        }`,
        'Content-Type': 'application/json',
        'X-Request-Id': `rotation-${database.batchCalls}`,
      },
      body: JSON.stringify(body),
    },
    {
      ...enabledEnvironment(database),
      ...extraEnvironment,
    },
  )
}

function enabledEnvironment(database: object) {
  return {
    DB: database as D1Database,
    HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
    HONOWARDEN_USER_KEY_ROTATION_ENABLED: 'true',
  }
}

async function accessTokenFor(user: RouteUser) {
  return signAccessToken('test-token-secret', {
    sub: user.id,
    email: user.emailNormalized,
    device: 'fixture-device',
    securityStamp: user.securityStamp,
    iat: 1,
    exp: 4_102_444_800,
  })
}

function passwordGrantRequest(
  database: RotationRouteD1Database,
  passwordHash: string,
) {
  return app.request(
    '/identity/connect/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        username: database.user.emailNormalized,
        password: passwordHash,
        scope: 'api offline_access',
        deviceIdentifier: 'rotation-login-device',
        deviceName: 'Rotation Route Test',
        deviceType: '8',
      }),
    },
    enabledEnvironment(database),
  )
}

function refreshGrantRequest(
  database: RotationRouteD1Database,
  refreshToken: string,
) {
  return app.request(
    '/identity/connect/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    },
    enabledEnvironment(database),
  )
}

function d1Result<T>(changes: number): D1Result<T> {
  return {
    success: true,
    results: [],
    meta: d1Meta(changes),
  }
}

function d1Meta(changes: number): D1Meta & Record<string, unknown> {
  return {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: changes,
    last_row_id: 0,
    changed_db: changes > 0,
    changes,
  }
}

class ExplodingD1Database {
  calls = 0

  prepare(): never {
    this.calls += 1
    throw new Error('D1 must not be called')
  }

  batch(): never {
    this.calls += 1
    throw new Error('D1 must not be called')
  }
}
