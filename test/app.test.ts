import { afterEach, describe, expect, it, vi } from 'vitest'

import app, { acceptNotificationHubWebSocket } from '../src/app'
import { attachmentStoragePolicy } from '../src/domain/attachment'
import { buildAuthRequestAccessCodeHash } from '../src/domain/auth-request'
import {
  buildAuthAttemptBucketKey,
  loginDefensePolicy,
} from '../src/domain/login-defense'
import { requestQuotaPolicy } from '../src/domain/request-quota'
import {
  notificationCredentialRevisionHeader,
  notificationSecurityStampHeader,
} from '../src/notification-hub'
import { encryptTotpSecret } from '../src/domain/totp-secret'
import { signAccessToken, verifyAccessToken } from '../src/domain/tokens'
import { hotp } from '../src/domain/totp'
import * as retentionCleanup from '../src/maintenance/retention-cleanup'
import { FakeD1Database, requiredTables } from './support/fake-d1'
import { FakeR2Bucket } from './support/fake-r2'

const testAttachmentStorageQuotaBytes = attachmentStoragePolicy.maxStorageBytes

class FakeWebSocket {
  accepted = false
  readyState = 1
  readonly sent: Array<string | ArrayBuffer> = []
  private readonly listeners = new Map<string, Array<(event: Event) => void>>()

  accept() {
    this.accepted = true
  }

  send(value: string | ArrayBuffer) {
    this.sent.push(value)
  }

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  emitMessage(data: string | ArrayBuffer) {
    this.emit('message', Object.assign(new Event('message'), { data }))
  }

  emitClose() {
    this.emit('close', new Event('close'))
  }

  emitError() {
    this.emit('error', new Event('error'))
  }

  private emit(type: string, event: Event) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }
}

class TwoPutBarrierR2Bucket extends FakeR2Bucket {
  private arrivals = 0
  private releaseBarrier!: () => void
  private readonly barrier = new Promise<void>((resolve) => {
    this.releaseBarrier = resolve
  })

  override async put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | Blob | string | null,
    options: { httpMetadata?: { contentType?: string } } = {},
  ): Promise<null> {
    this.arrivals += 1
    if (this.arrivals === 2) {
      this.releaseBarrier()
    }
    await this.barrier

    return super.put(key, value, options)
  }
}

function readBytes(value: string | ArrayBuffer | undefined): number[] {
  expect(value).toBeInstanceOf(ArrayBuffer)
  return [...new Uint8Array(value as ArrayBuffer)]
}

describe('HonoWarden app', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns service metadata from the root route', async () => {
    const response = await app.request('/', {
      headers: {
        'X-Request-Id': 'root-request',
      },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('X-Request-Id')).toBe('root-request')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    await expect(response.json()).resolves.toMatchObject({
      name: 'HonoWarden',
      status: 'pre-alpha',
      version: '0.1.0-alpha',
      requestId: 'root-request',
      links: {
        config: '/api/config',
        health: '/health',
      },
    })
  })

  it('returns a health response', async () => {
    const response = await app.request('/health', {
      headers: {
        'X-Request-Id': 'health-request',
      },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'honowarden',
      version: '0.1.0-alpha',
      environment: 'development',
      requestId: 'health-request',
    })
  })

  it('reports the configured deployment environment in health responses', async () => {
    const response = await app.request(
      '/health',
      {
        headers: {
          'X-Request-Id': 'staging-health-request',
        },
      },
      {
        HONOWARDEN_ENV: 'staging',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      service: 'honowarden',
      environment: 'staging',
      requestId: 'staging-health-request',
    })
  })

  it('records secret-safe global request quota buckets when enabled', async () => {
    const database = new FakeD1Database(null, [], {
      requestQuotaBucket: {
        bucketKey: 'request:anonymous:existing-hash',
        scope: 'anonymous',
        requestCount: 1,
        windowStartedAt: '2026-07-09T00:00:00.000Z',
        blockedUntil: null,
        updatedAt: '2026-07-09T00:00:00.000Z',
      },
    })

    const response = await app.request(
      '/api/config',
      {
        headers: {
          'CF-Connecting-IP': '203.0.113.10',
        },
      },
      {
        DB: database,
        HONOWARDEN_GLOBAL_REQUEST_QUOTA: 'true',
      },
    )

    expect(response.status).toBe(200)
    expect(database.requestQuotaWrites).toHaveLength(1)
    expect(database.requestQuotaWrites[0]).toMatchObject({
      scope: 'anonymous',
      limit: requestQuotaPolicy.anonymousLimit,
      windowSeconds: requestQuotaPolicy.windowSeconds,
      blockSeconds: requestQuotaPolicy.blockSeconds,
    })
    expect(database.requestQuotaWrites[0]?.bucketKey).toMatch(
      /^request:anonymous:[A-Za-z0-9_-]+$/,
    )
    expect(JSON.stringify(database.requestQuotaWrites)).not.toContain(
      '203.0.113.10',
    )
  })

  it('returns stable 429 responses for over-limit global request quota buckets', async () => {
    const response = await app.request(
      '/api/config',
      {
        headers: {
          Authorization: 'Bearer opaque-access-token',
          'CF-Connecting-IP': '203.0.113.10',
          'X-Request-Id': 'quota-limited-request',
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          requestQuotaBucket: {
            bucketKey: 'request:authenticated:existing-hash',
            scope: 'authenticated',
            requestCount: requestQuotaPolicy.authenticatedLimit + 1,
            windowStartedAt: '2026-07-09T00:00:00.000Z',
            blockedUntil: '2999-01-01T00:00:00.000Z',
            updatedAt: '2026-07-09T00:00:00.000Z',
          },
        }),
        HONOWARDEN_GLOBAL_REQUEST_QUOTA: 'true',
      },
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe(
      String(requestQuotaPolicy.blockSeconds),
    )
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'rate_limited',
      },
      requestId: 'quota-limited-request',
    })
  })

  it('fails global request quota checks loudly on database errors', async () => {
    const response = await app.request(
      '/api/config',
      {
        headers: {
          'CF-Connecting-IP': '203.0.113.10',
          'X-Request-Id': 'quota-database-failure-request',
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          requestQuotaInsertThrows: true,
        }),
        HONOWARDEN_GLOBAL_REQUEST_QUOTA: 'true',
      },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'database_unavailable',
      },
      requestId: 'quota-database-failure-request',
    })
  })

  it('keeps the healthz alias for infrastructure probes', async () => {
    const response = await app.request('/healthz', {
      headers: {
        'X-Request-Id': 'healthz-request',
      },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      service: 'honowarden',
      environment: 'development',
      requestId: 'healthz-request',
    })
  })

  it('returns database health for migrated D1 schema', async () => {
    const response = await app.request(
      '/health/db',
      {
        headers: {
          'X-Request-Id': 'db-health-request',
        },
      },
      {
        DB: new FakeD1Database('0001', [...requiredTables]),
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'honowarden',
      database: {
        schemaVersion: '0001',
        requiredTables: [...requiredTables],
      },
      requestId: 'db-health-request',
    })
  })

  it('returns 503 when D1 schema metadata is missing', async () => {
    const response = await app.request(
      '/health/db',
      {},
      {
        DB: new FakeD1Database(null, [...requiredTables]),
      },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      status: 'error',
      service: 'honowarden',
      database: {
        ok: false,
        code: 'schema_version_missing',
      },
    })
  })

  it('returns prelogin KDF parameters for an allowed email', async () => {
    const user = {
      ...authUserRecord(),
      kdfAlgorithm: 'argon2id',
      kdfIterations: 6,
      kdfMemory: 32,
      kdfParallelism: 4,
    }
    const response = await app.request(
      '/identity/accounts/prelogin',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'prelogin-request',
        },
        body: JSON.stringify({
          email: 'Person@Example.Test',
        }),
      },
      {
        DB: new FakeD1Database(null, [], { authUser: user }),
        HONOWARDEN_ALLOWED_EMAILS: 'person@example.test',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('X-Request-Id')).toBe('prelogin-request')
    await expect(response.json()).resolves.toEqual({
      kdf: 1,
      kdfIterations: 6,
      kdfMemory: 32,
      kdfParallelism: 4,
      kdfSettings: {
        kdfType: 1,
        iterations: 6,
        memory: 32,
        parallelism: 4,
      },
      salt: 'person@example.test',
    })
  })

  it('keeps the password prelogin alias for current CLI clients', async () => {
    const response = await app.request(
      '/identity/accounts/prelogin/password',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'Person@Example.Test',
        }),
      },
      {
        DB: new FakeD1Database(null, [], { authUser: null }),
        HONOWARDEN_ALLOWED_EMAILS: 'person@example.test',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      kdf: 0,
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
      kdfSettings: {
        kdfType: 0,
        iterations: 600000,
        memory: null,
        parallelism: null,
      },
      salt: 'person@example.test',
    })
  })

  it('uses the stored KDF population for an unknown allowlisted account', async () => {
    const legacyUser = {
      ...authUserRecord(),
      id: 'legacy-user-id',
      email: 'Legacy@Example.Test',
      emailNormalized: 'legacy@example.test',
      kdfIterations: 100000,
    }
    const response = await app.request(
      '/identity/accounts/prelogin',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'pending@example.test' }),
      },
      {
        DB: new FakeD1Database(null, [], { authUsers: [legacyUser] }),
        HONOWARDEN_ALLOWED_EMAILS: 'pending@example.test',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      kdf: 0,
      kdfIterations: 100000,
      kdfMemory: null,
      kdfParallelism: null,
    })
  })

  it('isolates unrelated invalid KDF rows from known and unknown prelogin', async () => {
    const validUser = {
      ...authUserRecord(),
      kdfIterations: 100000,
    }
    const invalidUser = {
      ...authUserRecord(),
      id: 'invalid-user-id',
      email: 'Invalid@Example.Test',
      emailNormalized: 'invalid@example.test',
      kdfAlgorithm: 'unknown-kdf',
    }
    const database = new FakeD1Database(null, [], {
      authUsers: [validUser, invalidUser],
    })
    const env = {
      DB: database,
      HONOWARDEN_ALLOWED_EMAILS: 'person@example.test pending@example.test',
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
    }

    for (const email of ['person@example.test', 'pending@example.test']) {
      const response = await app.request(
        '/identity/accounts/prelogin',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        },
        env,
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        kdf: 0,
        kdfIterations: 100000,
        kdfMemory: null,
        kdfParallelism: null,
      })
    }
  })

  it('keeps reversible account disable state out of prelogin KDF metadata', async () => {
    const disabledUser = {
      ...authUserRecord(),
      kdfAlgorithm: 'argon2id',
      kdfIterations: 6,
      kdfMemory: 32,
      kdfParallelism: 4,
      disabledAt: '2026-07-19T00:00:00.000Z',
    }
    const database = new FakeD1Database(null, [], {
      authUser: disabledUser,
    })
    const env = {
      DB: database,
      HONOWARDEN_ALLOWED_EMAILS: 'person@example.test pending@example.test',
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
    }

    for (const email of ['person@example.test', 'pending@example.test']) {
      const response = await app.request(
        '/identity/accounts/prelogin',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        },
        env,
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        kdf: 1,
        kdfIterations: 6,
        kdfMemory: 32,
        kdfParallelism: 4,
      })
    }

    const passwordGrant = await passwordGrantRequest(
      database,
      disabledUser.masterPasswordHash,
      'disabled-account-device',
    )
    expect(passwordGrant.status).toBe(400)
    await expect(passwordGrant.json()).resolves.toMatchObject({
      error: 'invalid_grant',
    })
  })

  it('fails prelogin loudly for an invalid stored KDF instead of projecting PBKDF2', async () => {
    const response = await app.request(
      '/identity/accounts/prelogin',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'person@example.test' }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: { ...authUserRecord(), kdfAlgorithm: 'unknown-kdf' },
        }),
        HONOWARDEN_ALLOWED_EMAILS: 'person@example.test',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'database_unavailable' },
    })
  })

  it('fails allowed prelogin before D1 when the decoy secret is missing', async () => {
    const database = new FakeD1Database(null, [], {
      authUser: authUserRecord(),
    })
    const prepare = vi.spyOn(database, 'prepare')
    const response = await app.request(
      '/identity/accounts/prelogin',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'person@example.test' }),
      },
      {
        DB: database,
        HONOWARDEN_ALLOWED_EMAILS: 'person@example.test',
      },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'server_misconfigured' },
    })
    expect(prepare).not.toHaveBeenCalled()
  })

  it('denies prelogin for emails outside the allowlist', async () => {
    const response = await app.request(
      '/identity/accounts/prelogin',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'person@example.test',
        }),
      },
      {
        HONOWARDEN_ALLOWED_EMAILS: '',
      },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'prelogin_not_allowed',
      },
    })
  })

  it('rejects malformed prelogin requests', async () => {
    const response = await app.request('/identity/accounts/prelogin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
      },
    })
  })

  it('returns true for a known active device during login preflight', async () => {
    const response = await app.request(
      '/api/devices/knowndevice',
      {
        headers: {
          'X-Request-Email': base64UrlEncode('Person@Example.Test'),
          'X-Device-Identifier': 'fixture-device',
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUsers: [authUserRecord()],
          devices: [
            {
              id: buildDevicePathId('fixture-device'),
              userId: 'user-id',
              identifier: 'fixture-device',
              name: 'CLI',
              type: 8,
              lastSeenAt: '2026-07-06T00:10:00.000Z',
              createdAt: '2026-07-06T00:00:00.000Z',
              updatedAt: '2026-07-06T00:10:00.000Z',
            },
          ],
        }),
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toBe(true)
  })

  it('returns false for unknown, cross-user, or revoked known-device lookups', async () => {
    const database = new FakeD1Database(null, [], {
      authUsers: [authUserRecord()],
      devices: [
        {
          id: 'other-user:fixture-device',
          userId: 'other-user',
          identifier: 'fixture-device',
          name: 'Other',
          type: 8,
          lastSeenAt: '2026-07-06T00:10:00.000Z',
          createdAt: '2026-07-06T00:00:00.000Z',
          updatedAt: '2026-07-06T00:10:00.000Z',
        },
        {
          id: buildDevicePathId('fixture-device'),
          userId: 'user-id',
          identifier: 'fixture-device',
          name: 'Revoked',
          type: 8,
          revokedAt: '2026-07-06T00:20:00.000Z',
          lastSeenAt: '2026-07-06T00:10:00.000Z',
          createdAt: '2026-07-06T00:00:00.000Z',
          updatedAt: '2026-07-06T00:20:00.000Z',
        },
      ],
    })
    const crossUserOrRevokedResponse = await app.request(
      '/api/devices/knowndevice',
      {
        headers: {
          'X-Request-Email': base64UrlEncode('Person@Example.Test'),
          'X-Device-Identifier': 'fixture-device',
        },
      },
      {
        DB: database,
      },
    )
    const unknownUserResponse = await app.request(
      '/api/devices/knowndevice',
      {
        headers: {
          'X-Request-Email': base64UrlEncode('unknown@example.test'),
          'X-Device-Identifier': 'fixture-device',
        },
      },
      {
        DB: database,
      },
    )

    expect(crossUserOrRevokedResponse.status).toBe(200)
    await expect(crossUserOrRevokedResponse.json()).resolves.toBe(false)
    expect(unknownUserResponse.status).toBe(200)
    await expect(unknownUserResponse.json()).resolves.toBe(false)
  })

  it('rejects missing or malformed known-device headers', async () => {
    const missingHeaderResponse = await app.request(
      '/api/devices/knowndevice',
      {
        headers: {
          'X-Request-Email': base64UrlEncode('Person@Example.Test'),
          'X-Request-Id': 'known-device-missing-header-request',
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUsers: [authUserRecord()],
        }),
      },
    )
    const malformedHeaderResponse = await app.request(
      '/api/devices/knowndevice',
      {
        headers: {
          'X-Request-Email': 'not base64url',
          'X-Device-Identifier': 'fixture-device',
          'X-Request-Id': 'known-device-invalid-header-request',
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUsers: [authUserRecord()],
        }),
      },
    )

    expect(missingHeaderResponse.status).toBe(400)
    await expect(missingHeaderResponse.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
      },
      requestId: 'known-device-missing-header-request',
    })
    expect(malformedHeaderResponse.status).toBe(400)
    await expect(malformedHeaderResponse.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
      },
      requestId: 'known-device-invalid-header-request',
    })
  })

  it('rejects public account registration', async () => {
    for (const path of [
      '/api/accounts/register',
      '/identity/accounts/register',
    ]) {
      const response = await app.request(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'person@example.test',
        }),
      })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: 'registration_disabled',
        },
      })
    }
  })

  it('returns explicit errors for unsupported alpha surfaces', async () => {
    for (const request of [
      { method: 'GET', path: '/api/organizations' },
      { method: 'POST', path: '/api/collections' },
      { method: 'POST', path: '/api/collections/collection-id' },
      { method: 'POST', path: '/api/ciphers/create' },
      { method: 'PUT', path: '/api/ciphers/cipher-id/share' },
      { method: 'PUT', path: '/api/ciphers/cipher-id/collections_v2' },
      { method: 'PUT', path: '/api/ciphers/share' },
      { method: 'POST', path: '/api/auth-requests' },
      { method: 'POST', path: '/api/auth-requests/auth-request-id' },
      { method: 'POST', path: '/api/attachments' },
      { method: 'GET', path: '/api/attachments/attachment-id' },
      { method: 'PATCH', path: '/api/devices/device-id' },
    ]) {
      const response = await app.request(request.path, {
        method: request.method,
        headers: {
          'X-Request-Id': 'unsupported-surface-request',
        },
      })

      expect(response.status).toBe(501)
      await expect(response.json()).resolves.toEqual({
        error: {
          code: 'unsupported_feature',
          message:
            'This feature is intentionally not implemented in the alpha scope.',
        },
        requestId: 'unsupported-surface-request',
      })
    }
  })

  it('creates an organization and projects its confirmed owner and default collection', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const organizations: Record<string, unknown>[] = []
    const organizationUsers: Record<string, unknown>[] = []
    const collections: Record<string, unknown>[] = []
    const collectionUsers: Record<string, unknown>[] = []
    const database = new FakeD1Database(null, [], {
      authUsers: [user],
      organizations,
      organizationUsers,
      collections,
      collectionUsers,
    })
    const env = {
      DB: database,
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
    }
    const requestBody = organizationCreateBody()
    const authorization = {
      Authorization: `Bearer ${accessToken}`,
    }

    const createResponse = await app.request(
      '/api/organizations',
      {
        method: 'POST',
        headers: {
          ...authorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      },
      env,
    )

    expect(createResponse.status).toBe(200)
    const created = (await createResponse.json()) as Record<string, unknown>
    expect(created).toEqual(
      organizationResponseShape({
        id: expect.any(String),
        name: requestBody.name,
        planType: requestBody.planType,
      }),
    )
    const organizationId = String(created.Id)
    expect(organizations).toEqual([
      expect.objectContaining({
        id: organizationId,
        name: requestBody.name,
        billingEmail: requestBody.billingEmail,
        planType: requestBody.planType,
        publicKey: requestBody.keys.publicKey,
        privateKey: requestBody.keys.encryptedPrivateKey,
        enabled: 1,
        useTotp: 1,
      }),
    ])
    expect(organizationUsers).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        organizationId,
        userId: user.id,
        email: user.email,
        orgKey: requestBody.key,
        status: 2,
        type: 0,
      }),
    ])
    const organizationUserId = String(organizationUsers[0]?.id)
    expect(collections).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        organizationId,
        encryptedName: requestBody.collectionName,
        type: 0,
      }),
    ])
    expect(collectionUsers).toEqual([
      {
        collectionId: collections[0]?.id,
        organizationUserId,
        readOnly: 0,
        hidePasswords: 0,
        manage: 1,
      },
    ])

    const getResponse = await app.request(
      `/api/organizations/${organizationId}`,
      { headers: authorization },
      env,
    )
    expect(getResponse.status).toBe(200)
    await expect(getResponse.json()).resolves.toEqual(created)

    const syncResponse = await app.request(
      '/api/sync',
      { headers: authorization },
      env,
    )
    expect(syncResponse.status).toBe(200)
    const sync = (await syncResponse.json()) as {
      profile: {
        organizations: unknown[]
        organizationsNew: unknown[]
      }
      collections: unknown[]
      ciphers: unknown[]
    }
    const projectedOrganization = profileOrganizationShape({
      id: organizationId,
      key: requestBody.key,
      name: requestBody.name,
      planType: requestBody.planType,
    })
    expect(sync.profile.organizations).toEqual([projectedOrganization])
    expect(sync.profile.organizationsNew).toEqual([projectedOrganization])
    expect(sync.collections).toEqual([
      {
        Object: 'collectionDetails',
        Id: collections[0]?.id,
        OrganizationId: organizationId,
        Name: requestBody.collectionName,
        ReadOnly: false,
        HidePasswords: false,
        Manage: true,
        Type: 0,
      },
    ])
    expect(sync.ciphers).toEqual([])

    const profileResponse = await app.request(
      '/api/accounts/profile',
      { headers: authorization },
      env,
    )
    expect(profileResponse.status).toBe(200)
    const profile = (await profileResponse.json()) as Record<string, unknown>
    expect(profile.organizations).toEqual([projectedOrganization])
    expect(profile.organizationsNew).toEqual([projectedOrganization])
    expect(profile.Organizations).toEqual([projectedOrganization])
    expect(profile.OrganizationsNew).toEqual([projectedOrganization])
  })

  it.each([
    ['name', { name: undefined }],
    ['key', { key: undefined }],
    ['keys', { keys: undefined }],
    [
      'keys.publicKey',
      { keys: { encryptedPrivateKey: '2.opaque-org-private-key' } },
    ],
    [
      'keys.encryptedPrivateKey',
      { keys: { publicKey: 'opaque-org-public-key' } },
    ],
    ['collectionName', { collectionName: undefined }],
  ])('rejects organization creation missing %s', async (_, override) => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/organizations',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'invalid-organization-request',
        },
        body: JSON.stringify({
          ...organizationCreateBody(),
          ...override,
        }),
      },
      {
        DB: new FakeD1Database(null, [], { authUser: user }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'invalid_request',
        message: 'Organization payload is invalid.',
      },
      requestId: 'invalid-organization-request',
    })
  })

  it('requires vault authentication to create an organization', async () => {
    const response = await app.request(
      '/api/organizations',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'unauthenticated-organization-request',
        },
        body: JSON.stringify(organizationCreateBody()),
      },
      { HONOWARDEN_TOKEN_SECRET: 'test-token-secret' },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'missing_token' },
      requestId: 'unauthenticated-organization-request',
    })
  })

  it('hides organizations and collections from another user', async () => {
    const owner = authUserRecord()
    const otherUser = {
      ...authUserRecord(),
      id: 'other-user-id',
      email: 'Other@Example.Test',
      emailNormalized: 'other@example.test',
      securityStamp: 'other-security-stamp',
    }
    const ownerAccessToken = await accessTokenFor(owner)
    const otherAccessToken = await accessTokenFor(otherUser)
    const database = new FakeD1Database(null, [], {
      authUsers: [owner, otherUser],
      organizations: [],
      organizationUsers: [],
      collections: [],
      collectionUsers: [],
    })
    const env = {
      DB: database,
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
    }
    const createResponse = await app.request(
      '/api/organizations',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(organizationCreateBody()),
      },
      env,
    )
    expect(createResponse.status).toBe(200)
    const created = (await createResponse.json()) as { Id: string }

    const syncResponse = await app.request(
      '/api/sync',
      {
        headers: { Authorization: `Bearer ${otherAccessToken}` },
      },
      env,
    )
    expect(syncResponse.status).toBe(200)
    await expect(syncResponse.json()).resolves.toMatchObject({
      profile: {
        organizations: [],
        organizationsNew: [],
      },
      collections: [],
    })

    for (const organizationId of [created.Id, 'missing-organization-id']) {
      const getResponse = await app.request(
        `/api/organizations/${organizationId}`,
        {
          headers: {
            Authorization: `Bearer ${otherAccessToken}`,
            'X-Request-Id': 'hidden-organization-request',
          },
        },
        env,
      )
      expect(getResponse.status).toBe(404)
      await expect(getResponse.json()).resolves.toEqual({
        error: {
          code: 'organization_not_found',
          message: 'Organization was not found.',
        },
        requestId: 'hidden-organization-request',
      })
    }
  })

  it('supports owner collection CRUD, assigned projections, and cascade cleanup', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'))
    const owner = authUserRecord()
    const accessToken = await accessTokenFor(owner)
    const organizations: Record<string, unknown>[] = []
    const organizationUsers: Record<string, unknown>[] = []
    const collections: Record<string, unknown>[] = []
    const collectionUsers: Record<string, unknown>[] = []
    const collectionCiphers: Record<string, unknown>[] = []
    const ciphers: Record<string, unknown>[] = []
    const database = new FakeD1Database(null, [], {
      authUsers: [owner],
      organizations,
      organizationUsers,
      collections,
      collectionUsers,
      collectionCiphers,
      ciphers,
    })
    const env = {
      DB: database,
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
    }
    const authorization = { Authorization: `Bearer ${accessToken}` }
    const organizationResponse = await app.request(
      '/api/organizations',
      {
        method: 'POST',
        headers: { ...authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify(organizationCreateBody()),
      },
      env,
    )
    expect(organizationResponse.status).toBe(200)
    const organization = (await organizationResponse.json()) as { Id: string }
    const organizationUserId = String(organizationUsers[0]?.id)
    const defaultCollectionId = String(collections[0]?.id)
    const foundationRevision = String(organizations[0]?.revisionDate)
    vi.setSystemTime(new Date('2026-07-16T00:00:10.000Z'))

    const createResponse = await app.request(
      `/api/organizations/${organization.Id}/collections`,
      {
        method: 'POST',
        headers: { ...authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: ' 2.opaque-created-collection\n',
          externalId: 'external-collection-reference',
          users: [],
          groups: [],
        }),
      },
      env,
    )

    expect(createResponse.status).toBe(200)
    const created = (await createResponse.json()) as Record<string, unknown>
    expect(created).toEqual(
      collectionAccessDetailsShape({
        id: expect.any(String),
        organizationId: organization.Id,
        name: ' 2.opaque-created-collection\n',
        externalId: 'external-collection-reference',
        organizationUserId,
      }),
    )
    const collectionId = String(created.Id)
    expect(collections).toContainEqual(
      expect.objectContaining({
        id: collectionId,
        organizationId: organization.Id,
        encryptedName: ' 2.opaque-created-collection\n',
        externalId: 'external-collection-reference',
        type: 0,
      }),
    )
    expect(collectionUsers).toContainEqual({
      collectionId,
      organizationUserId,
      readOnly: 0,
      hidePasswords: 0,
      manage: 1,
    })
    expect(organizations[0]).toMatchObject({
      revisionDate: '2026-07-16T00:00:10.000Z',
      updatedAt: '2026-07-16T00:00:10.000Z',
    })
    expect(organizations[0]?.revisionDate).not.toBe(foundationRevision)
    const revisionAfterCreateResponse = await app.request(
      '/api/accounts/revision-date',
      { headers: authorization },
      env,
    )
    expect(revisionAfterCreateResponse.status).toBe(200)
    await expect(revisionAfterCreateResponse.json()).resolves.toBe(
      '2026-07-16T00:00:10.000Z',
    )

    const organizationListResponse = await app.request(
      `/api/organizations/${organization.Id}/collections`,
      { headers: authorization },
      env,
    )
    expect(organizationListResponse.status).toBe(200)
    const organizationList = (await organizationListResponse.json()) as {
      object: string
      data: unknown[]
      continuationToken: null
    }
    expect(organizationList.object).toBe('list')
    expect(organizationList.continuationToken).toBeNull()
    expect(organizationList.data).toHaveLength(2)
    expect(organizationList.data).toEqual(
      expect.arrayContaining([
        collectionResponseShape({
          id: defaultCollectionId,
          organizationId: organization.Id,
          name: organizationCreateBody().collectionName,
          externalId: null,
        }),
        collectionResponseShape({
          id: collectionId,
          organizationId: organization.Id,
          name: ' 2.opaque-created-collection\n',
          externalId: 'external-collection-reference',
        }),
      ]),
    )

    const assignedListResponse = await app.request(
      '/api/collections',
      { headers: authorization },
      env,
    )
    expect(assignedListResponse.status).toBe(200)
    const assignedList = (await assignedListResponse.json()) as {
      object: string
      data: unknown[]
      continuationToken: null
    }
    expect(assignedList.object).toBe('list')
    expect(assignedList.continuationToken).toBeNull()
    expect(assignedList.data).toHaveLength(2)
    expect(assignedList.data).toEqual(
      expect.arrayContaining([
        collectionResponseShape({
          id: defaultCollectionId,
          organizationId: organization.Id,
          name: organizationCreateBody().collectionName,
          externalId: null,
        }),
        collectionResponseShape({
          id: collectionId,
          organizationId: organization.Id,
          name: ' 2.opaque-created-collection\n',
          externalId: 'external-collection-reference',
        }),
      ]),
    )

    const singleResponse = await app.request(
      `/api/organizations/${organization.Id}/collections/${collectionId}`,
      { headers: authorization },
      env,
    )
    expect(singleResponse.status).toBe(200)
    await expect(singleResponse.json()).resolves.toEqual(
      collectionResponseShape({
        id: collectionId,
        organizationId: organization.Id,
        name: ' 2.opaque-created-collection\n',
        externalId: 'external-collection-reference',
      }),
    )

    const detailsResponse = await app.request(
      `/api/organizations/${organization.Id}/collections/${collectionId}/details`,
      { headers: authorization },
      env,
    )
    expect(detailsResponse.status).toBe(200)
    await expect(detailsResponse.json()).resolves.toEqual(created)

    const usersResponse = await app.request(
      `/api/organizations/${organization.Id}/collections/${collectionId}/users`,
      { headers: authorization },
      env,
    )
    expect(usersResponse.status).toBe(200)
    await expect(usersResponse.json()).resolves.toEqual([
      collectionUserSelectionShape(organizationUserId),
    ])

    vi.setSystemTime(new Date('2026-07-16T00:00:20.000Z'))
    const renameResponse = await app.request(
      `/api/organizations/${organization.Id}/collections/${collectionId}`,
      {
        method: 'PUT',
        headers: { ...authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '2.opaque-renamed-collection' }),
      },
      env,
    )
    expect(renameResponse.status).toBe(200)
    const renamed = (await renameResponse.json()) as Record<string, unknown>
    expect(renamed).toEqual(
      collectionAccessDetailsShape({
        id: collectionId,
        organizationId: organization.Id,
        name: '2.opaque-renamed-collection',
        externalId: 'external-collection-reference',
        organizationUserId,
      }),
    )
    expect(collections).toContainEqual(
      expect.objectContaining({
        id: collectionId,
        encryptedName: '2.opaque-renamed-collection',
        externalId: 'external-collection-reference',
      }),
    )
    expect(organizations[0]).toMatchObject({
      revisionDate: '2026-07-16T00:00:20.000Z',
      updatedAt: '2026-07-16T00:00:20.000Z',
    })

    vi.setSystemTime(new Date('2026-07-16T00:00:25.000Z'))
    const pascalCaseUpdateResponse = await app.request(
      `/api/organizations/${organization.Id}/collections/${collectionId}`,
      {
        method: 'PUT',
        headers: { ...authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...renamed,
          Name: '2.pascal-case-round-trip',
          ExternalId: 'pascal-case-external-reference',
        }),
      },
      env,
    )
    expect(pascalCaseUpdateResponse.status).toBe(200)
    await expect(pascalCaseUpdateResponse.json()).resolves.toEqual(
      collectionAccessDetailsShape({
        id: collectionId,
        organizationId: organization.Id,
        name: '2.pascal-case-round-trip',
        externalId: 'pascal-case-external-reference',
        organizationUserId,
      }),
    )
    expect(collections).toContainEqual(
      expect.objectContaining({
        id: collectionId,
        encryptedName: '2.pascal-case-round-trip',
        externalId: 'pascal-case-external-reference',
      }),
    )
    expect(organizations[0]).toMatchObject({
      revisionDate: '2026-07-16T00:00:25.000Z',
      updatedAt: '2026-07-16T00:00:25.000Z',
    })

    vi.setSystemTime(new Date('2026-07-16T00:00:30.000Z'))
    const updateResponse = await app.request(
      `/api/organizations/${organization.Id}/collections/${collectionId}`,
      {
        method: 'PUT',
        headers: { ...authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '2.opaque-updated-collection',
          externalId: null,
          users: [
            {
              id: organizationUserId,
              readOnly: false,
              hidePasswords: false,
              manage: true,
            },
          ],
          groups: [],
        }),
      },
      env,
    )
    expect(updateResponse.status).toBe(200)
    await expect(updateResponse.json()).resolves.toEqual(
      collectionAccessDetailsShape({
        id: collectionId,
        organizationId: organization.Id,
        name: '2.opaque-updated-collection',
        externalId: null,
        organizationUserId,
      }),
    )
    expect(collections).toContainEqual(
      expect.objectContaining({
        id: collectionId,
        encryptedName: '2.opaque-updated-collection',
        externalId: null,
      }),
    )
    expect(organizations[0]).toMatchObject({
      revisionDate: '2026-07-16T00:00:30.000Z',
      updatedAt: '2026-07-16T00:00:30.000Z',
    })

    const syncResponse = await app.request(
      '/api/sync',
      { headers: authorization },
      env,
    )
    expect(syncResponse.status).toBe(200)
    await expect(syncResponse.json()).resolves.toMatchObject({
      collections: expect.arrayContaining([
        expect.objectContaining({
          Id: collectionId,
          OrganizationId: organization.Id,
          Name: '2.opaque-updated-collection',
          Manage: true,
        }),
      ]),
    })

    const organizationCipher = {
      ...cipherRecord(),
      id: 'organization-cipher-id',
      organizationId: organization.Id,
      cipherKey: '2.organization-cipher-key',
    }
    ciphers.push(organizationCipher)
    collectionCiphers.push({
      collectionId,
      cipherId: organizationCipher.id,
    })
    const revisionBeforeDelete = String(organizations[0]?.revisionDate)
    vi.setSystemTime(new Date('2026-07-16T00:01:00.000Z'))
    const rejectedDeleteResponse = await app.request(
      `/api/organizations/${organization.Id}/collections/${collectionId}`,
      { method: 'DELETE', headers: authorization },
      env,
    )
    expect(rejectedDeleteResponse.status).toBe(404)
    expect(collections.some((row) => row.id === collectionId)).toBe(true)
    expect(collectionCiphers).toEqual([
      { collectionId, cipherId: organizationCipher.id },
    ])
    expect(organizations[0]?.revisionDate).toBe(revisionBeforeDelete)

    collectionCiphers.push({
      collectionId: defaultCollectionId,
      cipherId: organizationCipher.id,
    })
    vi.setSystemTime(new Date('2026-07-16T00:02:00.000Z'))
    const deleteResponse = await app.request(
      `/api/organizations/${organization.Id}/collections/${collectionId}`,
      { method: 'DELETE', headers: authorization },
      env,
    )
    expect(deleteResponse.status).toBe(200)
    expect(await deleteResponse.text()).toBe('')
    expect(collections.some((row) => row.id === collectionId)).toBe(false)
    expect(
      collectionUsers.some((row) => row.collectionId === collectionId),
    ).toBe(false)
    expect(collectionCiphers).toEqual([
      {
        collectionId: defaultCollectionId,
        cipherId: organizationCipher.id,
      },
    ])
    expect(organizations[0]).toMatchObject({
      revisionDate: '2026-07-16T00:02:00.000Z',
      updatedAt: '2026-07-16T00:02:00.000Z',
    })
    expect(organizations[0]?.revisionDate).not.toBe(revisionBeforeDelete)
    const revisionAfterDeleteResponse = await app.request(
      '/api/accounts/revision-date',
      { headers: authorization },
      env,
    )
    expect(revisionAfterDeleteResponse.status).toBe(200)
    await expect(revisionAfterDeleteResponse.json()).resolves.toBe(
      '2026-07-16T00:02:00.000Z',
    )

    const deletedReadResponse = await app.request(
      `/api/organizations/${organization.Id}/collections/${collectionId}`,
      { headers: authorization },
      env,
    )
    expect(deletedReadResponse.status).toBe(404)
    await expect(deletedReadResponse.json()).resolves.toMatchObject({
      error: { code: 'collection_not_found' },
    })
  })

  it('bulk deletes collections atomically and validates the complete id set', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-16T00:03:00.000Z'))
    const owner = authUserRecord()
    const accessToken = await accessTokenFor(owner)
    const organizations: Record<string, unknown>[] = []
    const organizationUsers: Record<string, unknown>[] = []
    const collections: Record<string, unknown>[] = []
    const collectionUsers: Record<string, unknown>[] = []
    const collectionCiphers: Record<string, unknown>[] = []
    const ciphers: Record<string, unknown>[] = []
    const database = new FakeD1Database(null, [], {
      authUsers: [owner],
      organizations,
      organizationUsers,
      collections,
      collectionUsers,
      collectionCiphers,
      ciphers,
    })
    const env = {
      DB: database,
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
    }
    const authorization = { Authorization: `Bearer ${accessToken}` }
    const organizationResponse = await app.request(
      '/api/organizations',
      {
        method: 'POST',
        headers: { ...authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify(organizationCreateBody()),
      },
      env,
    )
    const organization = (await organizationResponse.json()) as { Id: string }

    const createdIds: string[] = []
    for (const name of ['2.first-created', '2.second-created']) {
      const response = await app.request(
        `/api/organizations/${organization.Id}/collections`,
        {
          method: 'POST',
          headers: { ...authorization, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        },
        env,
      )
      expect(response.status).toBe(200)
      createdIds.push(String(((await response.json()) as { Id: string }).Id))
    }
    ciphers.push(
      {
        ...cipherRecord(),
        id: 'cipher-one',
        organizationId: organization.Id,
        cipherKey: '2.cipher-one-key',
      },
      {
        ...cipherRecord(),
        id: 'cipher-two',
        organizationId: organization.Id,
        cipherKey: '2.cipher-two-key',
      },
    )
    collectionCiphers.push(
      { collectionId: createdIds[0], cipherId: 'cipher-one' },
      { collectionId: createdIds[1], cipherId: 'cipher-two' },
    )

    const partialAttempt = await app.request(
      `/api/organizations/${organization.Id}/collections`,
      {
        method: 'DELETE',
        headers: { ...authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [createdIds[0], 'missing-collection-id'] }),
      },
      env,
    )
    expect(partialAttempt.status).toBe(404)
    expect(
      createdIds.every((id) => collections.some((row) => row.id === id)),
    ).toBe(true)

    for (const ids of [[], [createdIds[0], createdIds[0]]]) {
      const invalidResponse = await app.request(
        `/api/organizations/${organization.Id}/collections`,
        {
          method: 'DELETE',
          headers: { ...authorization, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        },
        env,
      )
      expect(invalidResponse.status).toBe(400)
      await expect(invalidResponse.json()).resolves.toMatchObject({
        error: { code: 'invalid_request' },
      })
    }

    const orphaningAttempt = await app.request(
      `/api/organizations/${organization.Id}/collections`,
      {
        method: 'DELETE',
        headers: { ...authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: createdIds }),
      },
      env,
    )
    expect(orphaningAttempt.status).toBe(404)
    expect(
      createdIds.every((id) => collections.some((row) => row.id === id)),
    ).toBe(true)

    const defaultCollectionId = String(
      collections.find((row) => !createdIds.includes(String(row.id)))?.id,
    )
    collectionCiphers.push(
      { collectionId: defaultCollectionId, cipherId: 'cipher-one' },
      { collectionId: defaultCollectionId, cipherId: 'cipher-two' },
    )
    vi.setSystemTime(new Date('2026-07-16T00:04:00.000Z'))
    const deleteResponse = await app.request(
      `/api/organizations/${organization.Id}/collections`,
      {
        method: 'DELETE',
        headers: { ...authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: createdIds }),
      },
      env,
    )
    expect(deleteResponse.status).toBe(200)
    expect(await deleteResponse.text()).toBe('')
    expect(
      createdIds.some((id) => collections.some((row) => row.id === id)),
    ).toBe(false)
    expect(
      collectionUsers.some((row) =>
        createdIds.includes(String(row.collectionId)),
      ),
    ).toBe(false)
    expect(collectionCiphers).toEqual([
      { collectionId: defaultCollectionId, cipherId: 'cipher-one' },
      { collectionId: defaultCollectionId, cipherId: 'cipher-two' },
    ])
    expect(organizations[0]).toMatchObject({
      revisionDate: '2026-07-16T00:04:00.000Z',
      updatedAt: '2026-07-16T00:04:00.000Z',
    })
  })

  it('enforces confirmed assignment reads and owner-only collection mutations', async () => {
    const owner = authUserRecord()
    const member = {
      ...authUserRecord(),
      id: 'member-user-id',
      email: 'Member@Example.Test',
      emailNormalized: 'member@example.test',
      securityStamp: 'member-security-stamp',
    }
    const unconfirmed = {
      ...authUserRecord(),
      id: 'unconfirmed-user-id',
      email: 'Unconfirmed@Example.Test',
      emailNormalized: 'unconfirmed@example.test',
      securityStamp: 'unconfirmed-security-stamp',
    }
    const ownerToken = await accessTokenFor(owner)
    const memberToken = await accessTokenFor(member)
    const unconfirmedToken = await accessTokenFor(unconfirmed)
    const organizations: Record<string, unknown>[] = []
    const organizationUsers: Record<string, unknown>[] = []
    const collections: Record<string, unknown>[] = []
    const collectionUsers: Record<string, unknown>[] = []
    const database = new FakeD1Database(null, [], {
      authUsers: [owner, member, unconfirmed],
      organizations,
      organizationUsers,
      collections,
      collectionUsers,
    })
    const env = {
      DB: database,
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
    }
    const ownerAuthorization = { Authorization: `Bearer ${ownerToken}` }
    const organizationResponse = await app.request(
      '/api/organizations',
      {
        method: 'POST',
        headers: {
          ...ownerAuthorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(organizationCreateBody()),
      },
      env,
    )
    const organization = (await organizationResponse.json()) as { Id: string }
    const createResponse = await app.request(
      `/api/organizations/${organization.Id}/collections`,
      {
        method: 'POST',
        headers: {
          ...ownerAuthorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: '2.member-readable' }),
      },
      env,
    )
    const collection = (await createResponse.json()) as { Id: string }
    organizationUsers.push(
      {
        id: 'member-organization-user-id',
        organizationId: organization.Id,
        userId: member.id,
        email: member.email,
        orgKey: '2.member-org-key',
        status: 2,
        type: 2,
        permissions: null,
      },
      {
        id: 'unconfirmed-organization-user-id',
        organizationId: organization.Id,
        userId: unconfirmed.id,
        email: unconfirmed.email,
        orgKey: '2.unconfirmed-org-key',
        status: 1,
        type: 2,
        permissions: null,
      },
    )
    collectionUsers.push(
      {
        collectionId: collection.Id,
        organizationUserId: 'member-organization-user-id',
        readOnly: 1,
        hidePasswords: 1,
        manage: 0,
      },
      {
        collectionId: collection.Id,
        organizationUserId: 'unconfirmed-organization-user-id',
        readOnly: 0,
        hidePasswords: 0,
        manage: 1,
      },
    )

    const memberAuthorization = { Authorization: `Bearer ${memberToken}` }
    const assignedResponse = await app.request(
      '/api/collections',
      { headers: memberAuthorization },
      env,
    )
    expect(assignedResponse.status).toBe(200)
    await expect(assignedResponse.json()).resolves.toEqual({
      object: 'list',
      data: [
        collectionResponseShape({
          id: collection.Id,
          organizationId: organization.Id,
          name: '2.member-readable',
          externalId: null,
        }),
      ],
      continuationToken: null,
    })

    const memberListResponse = await app.request(
      `/api/organizations/${organization.Id}/collections`,
      { headers: memberAuthorization },
      env,
    )
    expect(memberListResponse.status).toBe(200)
    await expect(memberListResponse.json()).resolves.toEqual({
      object: 'list',
      data: [
        collectionResponseShape({
          id: collection.Id,
          organizationId: organization.Id,
          name: '2.member-readable',
          externalId: null,
        }),
      ],
      continuationToken: null,
    })

    const memberReadResponse = await app.request(
      `/api/organizations/${organization.Id}/collections/${collection.Id}`,
      { headers: memberAuthorization },
      env,
    )
    expect(memberReadResponse.status).toBe(200)

    for (const request of [
      {
        method: 'POST',
        path: `/api/organizations/${organization.Id}/collections`,
        body: { name: '2.denied-create' },
        errorCode: 'organization_not_found',
      },
      {
        method: 'PUT',
        path: `/api/organizations/${organization.Id}/collections/${collection.Id}`,
        body: { name: '2.denied-update' },
        errorCode: 'collection_not_found',
      },
      {
        method: 'DELETE',
        path: `/api/organizations/${organization.Id}/collections/${collection.Id}`,
        errorCode: 'collection_not_found',
      },
      {
        method: 'GET',
        path: `/api/organizations/${organization.Id}/collections/${collection.Id}/details`,
        errorCode: 'collection_not_found',
      },
      {
        method: 'GET',
        path: `/api/organizations/${organization.Id}/collections/${collection.Id}/users`,
        errorCode: 'collection_not_found',
      },
    ]) {
      const response = await app.request(
        request.path,
        {
          method: request.method,
          headers: {
            ...memberAuthorization,
            'Content-Type': 'application/json',
            'X-Request-Id': 'hidden-collection-request',
          },
          ...(request.body ? { body: JSON.stringify(request.body) } : {}),
        },
        env,
      )
      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toEqual({
        error: {
          code: request.errorCode,
          message:
            request.errorCode === 'organization_not_found'
              ? 'Organization was not found.'
              : 'Collection was not found.',
        },
        requestId: 'hidden-collection-request',
      })
    }

    const unconfirmedAuthorization = {
      Authorization: `Bearer ${unconfirmedToken}`,
    }
    const unconfirmedListResponse = await app.request(
      '/api/collections',
      { headers: unconfirmedAuthorization },
      env,
    )
    expect(unconfirmedListResponse.status).toBe(200)
    await expect(unconfirmedListResponse.json()).resolves.toEqual({
      object: 'list',
      data: [],
      continuationToken: null,
    })
    const hiddenResponse = await app.request(
      `/api/organizations/${organization.Id}/collections/${collection.Id}`,
      {
        headers: {
          ...unconfirmedAuthorization,
          'X-Request-Id': 'unconfirmed-hidden-collection-request',
        },
      },
      env,
    )
    expect(hiddenResponse.status).toBe(404)
    await expect(hiddenResponse.json()).resolves.toMatchObject({
      error: { code: 'collection_not_found' },
      requestId: 'unconfirmed-hidden-collection-request',
    })
  })

  it('validates collection payloads and rejects unsupported access assignments', async () => {
    const owner = authUserRecord()
    const accessToken = await accessTokenFor(owner)
    const organizations: Record<string, unknown>[] = []
    const organizationUsers: Record<string, unknown>[] = []
    const collections: Record<string, unknown>[] = []
    const collectionUsers: Record<string, unknown>[] = []
    const database = new FakeD1Database(null, [], {
      authUsers: [owner],
      organizations,
      organizationUsers,
      collections,
      collectionUsers,
    })
    const env = {
      DB: database,
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
    }
    const authorization = { Authorization: `Bearer ${accessToken}` }
    const organizationResponse = await app.request(
      '/api/organizations',
      {
        method: 'POST',
        headers: { ...authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify(organizationCreateBody()),
      },
      env,
    )
    const organization = (await organizationResponse.json()) as { Id: string }
    const organizationUserId = String(organizationUsers[0]?.id)

    for (const payload of [
      {},
      { name: '' },
      { name: 42 },
      { name: '2.valid', externalId: 'x'.repeat(301) },
      {
        name: '2.valid',
        users: [
          {
            id: organizationUserId,
            readOnly: true,
            hidePasswords: false,
            manage: true,
          },
        ],
      },
    ]) {
      const response = await app.request(
        `/api/organizations/${organization.Id}/collections`,
        {
          method: 'POST',
          headers: {
            ...authorization,
            'Content-Type': 'application/json',
            'X-Request-Id': 'invalid-collection-request',
          },
          body: JSON.stringify(payload),
        },
        env,
      )
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'invalid_request' },
        requestId: 'invalid-collection-request',
      })
    }

    for (const payload of [
      {
        name: '2.valid',
        groups: [
          {
            id: 'unsupported-group-id',
            readOnly: false,
            hidePasswords: false,
            manage: true,
          },
        ],
      },
      {
        name: '2.valid',
        users: [
          {
            id: 'other-organization-user-id',
            readOnly: false,
            hidePasswords: false,
            manage: true,
          },
        ],
      },
      {
        Name: '2.valid',
        Users: [
          {
            Id: 'other-organization-user-id',
            ReadOnly: false,
            HidePasswords: false,
            Manage: true,
          },
        ],
      },
    ]) {
      const response = await app.request(
        `/api/organizations/${organization.Id}/collections`,
        {
          method: 'POST',
          headers: {
            ...authorization,
            'Content-Type': 'application/json',
            'X-Request-Id': 'unsupported-collection-access-request',
          },
          body: JSON.stringify(payload),
        },
        env,
      )
      expect(response.status).toBe(501)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'unsupported_feature' },
        requestId: 'unsupported-collection-access-request',
      })
    }
  })

  it('returns client-readable unsupported errors for premium surfaces', async () => {
    const message = 'This feature is unavailable on this server.'
    const requests = [
      // Emergency Access endpoints shipped in the pinned browser extension.
      { method: 'GET', path: '/api/emergency-access/trusted' },
      {
        method: 'GET',
        path: '/api/emergency-access/emergency-id/cipher-id/attachment/attachment-id',
      },
      // Keep the unsupported route-family root explicit as well.
      { method: 'POST', path: '/api/emergency-access' },
      // The only server-origin vault breach report in the pinned extension.
      {
        method: 'GET',
        path: '/api/hibp/breach?username=person%40example.test',
      },
      // File-specific Send endpoints.
      { method: 'POST', path: '/api/sends/file/v2' },
      { method: 'GET', path: '/api/sends/send-id/file/file-id' },
      { method: 'POST', path: '/api/sends/send-id/file/file-id' },
      {
        method: 'POST',
        path: '/api/sends/send-id/access/file/file-id',
      },
      { method: 'POST', path: '/api/sends/access/file/file-id' },
      // Generic Send endpoints used by file Send flows.
      { method: 'GET', path: '/api/sends/send-id' },
      { method: 'POST', path: '/api/sends/access/send-id' },
      { method: 'POST', path: '/api/sends/access' },
      { method: 'GET', path: '/api/sends' },
      { method: 'PUT', path: '/api/sends/send-id/remove-password' },
      { method: 'DELETE', path: '/api/sends/send-id' },
      { method: 'PUT', path: '/api/sends/send-id' },
      // V2 public Send access obtains a Send-scoped token first.
      {
        method: 'POST',
        path: '/identity/connect/token',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: 'send',
          grant_type: 'send_access',
          scope: 'api.send.access',
          send_id: 'send-id',
        }).toString(),
      },
      // Text Send creation remains unsupported under ADR 0003 as well.
      { method: 'POST', path: '/api/sends' },
    ]

    for (const request of requests) {
      const response = await app.request(request.path, {
        method: request.method,
        headers: {
          'X-Request-Id': 'unsupported-premium-surface-request',
          ...request.headers,
        },
        ...(request.body === undefined ? {} : { body: request.body }),
      })

      expect(response.status, `${request.method} ${request.path}`).toBe(501)
      await expect(response.json()).resolves.toEqual({
        Message: message,
        error: {
          code: 'unsupported_feature',
          message,
        },
        requestId: 'unsupported-premium-surface-request',
      })
    }
  })

  it('fails closed when auth-request routes are enabled without their secret', async () => {
    const response = await app.request(
      '/api/auth-requests',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Device-Identifier': 'requester-device',
          'Device-Type': '8',
        },
        body: JSON.stringify({
          email: 'person@example.test',
          publicKey: 'opaque-public-key',
          deviceIdentifier: 'requester-device',
          accessCode: 'high-entropy-access-code',
          type: 0,
        }),
      },
      { HONOWARDEN_AUTH_REQUESTS_ENABLED: 'true' },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'server_misconfigured' },
    })
  })

  it('runs create, owner approval, and constant-time response polling', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const authRequests: Record<string, unknown>[] = []
    const database = new FakeD1Database(null, [], {
      authUser: user,
      authRequests,
      requestQuotaBucket: {
        bucketKey: 'request:anonymous:auth-request-quota',
        scope: 'anonymous',
        requestCount: 1,
        windowStartedAt: '2026-07-11T00:00:00.000Z',
        blockedUntil: null,
        updatedAt: '2026-07-11T00:00:00.000Z',
      },
      devices: [
        {
          id: 'approver-device-id',
          userId: user.id,
          identifier: 'fixture-device',
          name: 'Approver',
          type: 8,
          encryptedUserKey: null,
          encryptedPublicKey: null,
          encryptedPrivateKey: null,
          lastSeenAt: null,
          createdAt: '2026-07-11T00:00:00.000Z',
          updatedAt: '2026-07-11T00:00:00.000Z',
          revokedAt: null,
        },
      ],
    })
    const notificationFetch = vi.fn().mockResolvedValue(new Response(null))
    const notificationHub = {
      idFromName: vi.fn((name: string) => `do:${name}`),
      get: vi.fn(() => ({ fetch: notificationFetch })),
    }
    const env = {
      DB: database as unknown as D1Database,
      NOTIFICATION_HUB: notificationHub as unknown as DurableObjectNamespace,
      HONOWARDEN_AUTH_REQUESTS_ENABLED: 'true',
      HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED: 'true',
      HONOWARDEN_AUTH_REQUEST_SECRET: '0123456789abcdef0123456789abcdef',
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
    }

    const createResponse = await app.request(
      '/api/auth-requests/',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Device-Identifier': 'requester-device',
          'Device-Type': '8',
        },
        body: JSON.stringify({
          email: user.email,
          publicKey: 'opaque-public-key',
          deviceIdentifier: 'requester-device',
          accessCode: 'high-entropy-access-code',
          type: 0,
        }),
      },
      env,
    )

    expect(createResponse.status).toBe(200)
    const created = (await createResponse.json()) as {
      id: string
      object: string
      requestDeviceTypeValue: number
      requestApproved: boolean
    }
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(created).toMatchObject({
      object: 'auth-request',
      requestDeviceTypeValue: 8,
      requestApproved: false,
    })
    expect(authRequests).toHaveLength(1)
    expect(authRequests[0]).not.toHaveProperty('accessCode')
    expect(authRequests[0]?.accessCodeHash).toMatch(/^hmac-sha256:/)
    await vi.waitFor(() => expect(notificationFetch).toHaveBeenCalledOnce())
    expect(notificationHub.idFromName).toHaveBeenCalledWith(user.id)
    expect(notificationFetch).toHaveBeenNthCalledWith(
      1,
      'https://notification-hub/notify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          requestId: created.id,
          userId: user.id,
          type: 15,
          securityStamp: user.securityStamp,
          revisionDate: user.revisionDate,
        }),
      }),
    )

    const pendingResponse = await app.request(
      '/api/auth-requests/pending',
      { headers: { Authorization: `Bearer ${accessToken}` } },
      env,
    )
    expect(pendingResponse.status).toBe(200)
    await expect(pendingResponse.json()).resolves.toMatchObject({
      data: [
        {
          id: created.id,
          requestApproved: false,
          requestDeviceType: 'Device 8',
          requestDeviceTypeValue: 8,
        },
      ],
    })

    const approvalResponse = await app.request(
      `/api/auth-requests/${created.id}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestApproved: true,
          key: 'opaque-encrypted-key',
          deviceIdentifier: 'fixture-device',
          masterPasswordHash: null,
        }),
      },
      env,
    )
    expect(approvalResponse.status).toBe(200)
    await vi.waitFor(() => expect(notificationFetch).toHaveBeenCalledTimes(2))
    expect(notificationHub.idFromName).toHaveBeenNthCalledWith(
      2,
      `auth-request:${created.id}`,
    )
    expect(notificationFetch).toHaveBeenNthCalledWith(
      2,
      'https://notification-hub/notify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          requestId: created.id,
          userId: user.id,
          type: 16,
        }),
      }),
    )

    const replayResponse = await app.request(
      `/api/auth-requests/${created.id}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestApproved: true,
          key: 'opaque-encrypted-key',
        }),
      },
      env,
    )
    expect(replayResponse.status).toBe(200)
    expect(notificationFetch).toHaveBeenCalledTimes(2)

    const pollResponse = await app.request(
      `/api/auth-requests/${created.id}/response?code=high-entropy-access-code`,
      undefined,
      env,
    )
    expect(pollResponse.status).toBe(200)
    await expect(pollResponse.json()).resolves.toMatchObject({
      id: created.id,
      requestApproved: true,
      key: 'opaque-encrypted-key',
    })
  })

  it('supersedes only older pending requests from the same requester device on resend', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const authRequests: Record<string, unknown>[] = []
    const database = new FakeD1Database(null, [], {
      authUser: user,
      authRequests,
      requestQuotaBucket: unblockedRequestQuotaBucket(),
      devices: [deviceRecord()],
    })
    const secret = '0123456789abcdef0123456789abcdef'
    const env = {
      DB: database as unknown as D1Database,
      HONOWARDEN_AUTH_REQUESTS_ENABLED: 'true',
      HONOWARDEN_AUTH_REQUEST_SECRET: secret,
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
    }

    const createRequest = async (
      deviceIdentifier: string,
      accessCode: string,
    ) => {
      const response = await app.request(
        '/api/auth-requests',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Device-Identifier': deviceIdentifier,
            'Device-Type': '8',
          },
          body: JSON.stringify({
            email: user.email,
            publicKey: `opaque-public-key-${deviceIdentifier}`,
            deviceIdentifier,
            accessCode,
            type: 0,
          }),
        },
        env,
      )

      expect(response.status).toBe(200)
      return (await response.json()) as { id: string }
    }

    const firstAccessCode = 'first-high-entropy-access-code'
    const first = await createRequest('requester-device', firstAccessCode)
    const otherDevice = await createRequest(
      'other-requester-device',
      'other-high-entropy-access-code',
    )
    const replacement = await createRequest(
      'requester-device',
      'replacement-high-entropy-access-code',
    )

    const pendingResponse = await app.request(
      '/api/auth-requests/pending',
      { headers: { Authorization: `Bearer ${accessToken}` } },
      env,
    )
    expect(pendingResponse.status).toBe(200)
    const pending = (await pendingResponse.json()) as {
      data: Array<{ id: string }>
    }
    const pendingIds = pending.data.map((request) => request.id)
    expect(pendingIds).toHaveLength(2)
    expect(pendingIds).toEqual(
      expect.arrayContaining([replacement.id, otherDevice.id]),
    )
    expect(pendingIds).not.toContain(first.id)
    expect(
      authRequests.find((request) => request.id === first.id),
    ).toMatchObject({ status: 'superseded', requestApproved: 0 })
    expect(
      authRequests.find((request) => request.id === otherDevice.id),
    ).toMatchObject({ status: 'pending' })

    const obsoleteApprovalResponse = await app.request(
      `/api/auth-requests/${first.id}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'obsolete-auth-request-approval',
        },
        body: JSON.stringify({
          requestApproved: true,
          key: 'opaque-encrypted-key',
        }),
      },
      env,
    )
    expect(obsoleteApprovalResponse.status).toBe(409)
    const obsoleteApproval = await obsoleteApprovalResponse.json()
    expect(obsoleteApproval).toMatchObject({
      error: { code: 'auth_request_conflict' },
      requestId: 'obsolete-auth-request-approval',
    })
    expect(JSON.stringify(obsoleteApproval)).not.toContain('superseded')

    const obsoletePollResponse = await app.request(
      `/api/auth-requests/${first.id}/response?code=${firstAccessCode}`,
      { headers: { 'X-Request-Id': 'obsolete-auth-request-poll' } },
      env,
    )
    expect(obsoletePollResponse.status).toBe(404)
    const obsoletePoll = await obsoletePollResponse.json()
    expect(obsoletePoll).toMatchObject({
      error: { code: 'auth_request_not_found' },
      requestId: 'obsolete-auth-request-poll',
    })
    expect(JSON.stringify(obsoletePoll)).not.toContain('superseded')

    const replacementApprovalResponse = await app.request(
      `/api/auth-requests/${replacement.id}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestApproved: true,
          key: 'replacement-encrypted-key',
        }),
      },
      env,
    )
    expect(replacementApprovalResponse.status).toBe(200)
    await expect(replacementApprovalResponse.json()).resolves.toMatchObject({
      id: replacement.id,
      requestApproved: true,
      key: 'replacement-encrypted-key',
    })
    expect(
      authRequests.find((request) => request.id === replacement.id),
    ).toMatchObject({ status: 'approved' })
    expect(
      authRequests.find((request) => request.id === otherDevice.id),
    ).toMatchObject({ status: 'pending' })
  })

  it('expires an unswept stored-pending request before a same-owner-device resend', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T00:00:00.000Z'))

    const user = authUserRecord()
    const authRequests: Record<string, unknown>[] = []
    const database = new FakeD1Database(null, [], {
      authUser: user,
      authRequests,
      requestQuotaBucket: unblockedRequestQuotaBucket(),
    })
    const env = {
      DB: database as unknown as D1Database,
      HONOWARDEN_AUTH_REQUESTS_ENABLED: 'true',
      HONOWARDEN_AUTH_REQUEST_SECRET: '0123456789abcdef0123456789abcdef',
    }
    const createRequest = () =>
      app.request(
        '/api/auth-requests',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Device-Identifier': 'requester-device',
            'Device-Type': '8',
          },
          body: JSON.stringify({
            email: user.email,
            publicKey: 'opaque-public-key',
            deviceIdentifier: 'requester-device',
            accessCode: 'high-entropy-access-code',
            type: 0,
          }),
        },
        env,
      )

    const firstResponse = await createRequest()
    expect(firstResponse.status).toBe(200)
    const first = (await firstResponse.json()) as { id: string }
    expect(authRequests).toHaveLength(1)
    expect(authRequests[0]).toMatchObject({
      id: first.id,
      status: 'pending',
      expiresAt: '2026-07-11T00:15:00.000Z',
    })

    vi.setSystemTime(new Date('2026-07-11T00:15:00.001Z'))

    const replacementResponse = await createRequest()
    expect(replacementResponse.status).toBe(200)
    const replacement = (await replacementResponse.json()) as {
      id: string
      object: string
      requestApproved: boolean
    }
    expect(replacement).toMatchObject({
      object: 'auth-request',
      publicKey: 'opaque-public-key',
      requestDeviceType: 'Device 8',
      requestDeviceTypeValue: 8,
      requestDeviceIdentifier: 'requester-device',
      type: 0,
      creationDate: '2026-07-11T00:15:00.001Z',
      responseDate: null,
      requestApproved: false,
      key: null,
      requestDeviceId: null,
    })
    expect(replacement.id).not.toBe(first.id)
    expect(authRequests).toHaveLength(2)
    expect(
      authRequests.find((request) => request.id === first.id),
    ).toMatchObject({
      status: 'expired',
      requestApproved: null,
      updatedAt: '2026-07-11T00:15:00.001Z',
    })
    expect(
      authRequests.find((request) => request.id === replacement.id),
    ).toMatchObject({ status: 'pending' })
  })

  it('keeps polling authoritative when auth-request notification delivery fails', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const row = authRequestRecord()
    const database = new FakeD1Database(null, [], {
      authUser: user,
      authRequests: [row],
      devices: [deviceRecord()],
    })
    const notificationFetch = vi
      .fn()
      .mockRejectedValue(new Error('do unavailable'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await app.request(
      '/api/auth-requests/auth-request-id',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'approval-with-notification-failure',
        },
        body: JSON.stringify({
          requestApproved: false,
        }),
      },
      {
        DB: database as unknown as D1Database,
        NOTIFICATION_HUB: {
          idFromName: () => 'user-object',
          get: () => ({ fetch: notificationFetch }),
        } as unknown as DurableObjectNamespace,
        HONOWARDEN_AUTH_REQUESTS_ENABLED: 'true',
        HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED: 'true',
        HONOWARDEN_AUTH_REQUEST_SECRET: '0123456789abcdef0123456789abcdef',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      id: 'auth-request-id',
      requestApproved: false,
    })
    await vi.waitFor(() => expect(error).toHaveBeenCalledOnce())
    expect(row.status).toBe('denied')
    expect(error.mock.calls[0]?.[0]).toContain(
      'auth_request_notification_failed',
    )
    expect(error.mock.calls[0]?.[0]).not.toContain('security-stamp')
  })

  it('rejects auth-request self-approval without revealing transition details', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const database = new FakeD1Database(null, [], {
      authUser: user,
      authRequests: [
        {
          ...authRequestRecord(),
          requestDeviceIdentifier: 'fixture-device',
        },
      ],
      devices: [deviceRecord()],
    })

    const response = await app.request(
      '/api/auth-requests/auth-request-id',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestApproved: true,
          key: 'opaque-encrypted-key',
        }),
      },
      {
        DB: database as unknown as D1Database,
        HONOWARDEN_AUTH_REQUESTS_ENABLED: 'true',
        HONOWARDEN_AUTH_REQUEST_SECRET: '0123456789abcdef0123456789abcdef',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'auth_request_conflict' },
    })
  })

  it('denies an auth request without accepting or returning key material', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const secret = '0123456789abcdef0123456789abcdef'
    const accessCode = 'high-entropy-access-code'
    const row = {
      ...authRequestRecord(),
      accessCodeHash: await buildAuthRequestAccessCodeHash(
        secret,
        'auth-request-id',
        accessCode,
      ),
    }
    const database = new FakeD1Database(null, [], {
      authUser: user,
      authRequests: [row],
      requestQuotaBucket: unblockedRequestQuotaBucket(),
      devices: [deviceRecord()],
    })
    const env = {
      DB: database as unknown as D1Database,
      HONOWARDEN_AUTH_REQUESTS_ENABLED: 'true',
      HONOWARDEN_AUTH_REQUEST_SECRET: secret,
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
    }

    const denyResponse = await app.request(
      '/api/auth-requests/auth-request-id',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestApproved: false,
          deviceIdentifier: 'fixture-device',
        }),
      },
      env,
    )
    expect(denyResponse.status).toBe(200)
    await expect(denyResponse.json()).resolves.toMatchObject({
      id: 'auth-request-id',
      requestApproved: false,
      key: null,
      responseDate: expect.any(String),
    })

    const pollResponse = await app.request(
      `/api/auth-requests/auth-request-id/response?code=${accessCode}`,
      undefined,
      env,
    )
    expect(pollResponse.status).toBe(200)
    await expect(pollResponse.json()).resolves.toMatchObject({
      requestApproved: false,
      key: null,
    })
    expect(row.encryptedResponseKey).toBeNull()
  })

  it('rejects anonymous auth-request creation when a dedicated quota is blocked', async () => {
    const authRequests: Record<string, unknown>[] = []
    const database = new FakeD1Database(null, [], {
      authRequests,
      requestQuotaBucket: {
        bucketKey: 'request:anonymous:blocked-auth-request-quota',
        scope: 'anonymous',
        requestCount: 31,
        windowStartedAt: '2026-07-11T00:00:00.000Z',
        blockedUntil: '2999-07-11T00:15:00.000Z',
        updatedAt: '2026-07-11T00:00:00.000Z',
      },
    })

    const response = await app.request(
      '/api/auth-requests',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'person@example.test',
          publicKey: 'opaque-public-key',
          deviceIdentifier: 'requester-device',
          deviceType: 8,
          accessCode: 'high-entropy-access-code',
          type: 0,
        }),
      },
      {
        DB: database as unknown as D1Database,
        HONOWARDEN_AUTH_REQUESTS_ENABLED: 'true',
        HONOWARDEN_AUTH_REQUEST_SECRET: '0123456789abcdef0123456789abcdef',
      },
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('900')
    expect(authRequests).toHaveLength(0)
  })

  it('keeps account bootstrap disabled by default', async () => {
    const response = await app.request('/api/accounts/bootstrap', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'person@example.test',
        masterPasswordHash: 'synthetic-master-password-hash',
      }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'bootstrap_disabled',
      },
    })
  })

  it('requires a bootstrap token when bootstrap is enabled', async () => {
    const response = await app.request(
      '/api/accounts/bootstrap',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'person@example.test',
          masterPasswordHash: 'synthetic-master-password-hash',
        }),
      },
      {
        HONOWARDEN_BOOTSTRAP_ENABLED: 'true',
        HONOWARDEN_BOOTSTRAP_TOKEN: 'expected-token',
      },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'bootstrap_forbidden',
      },
    })
  })

  it('creates an allowlisted bootstrap account', async () => {
    const response = await app.request(
      '/api/accounts/bootstrap',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-HonoWarden-Bootstrap-Token': 'expected-token',
          'X-Request-Id': 'bootstrap-create-request',
        },
        body: JSON.stringify({
          email: 'Person@Example.Test',
          masterPasswordHash: 'synthetic-master-password-hash',
          userKey: '2.synthetic-user-key',
        }),
      },
      {
        DB: new FakeD1Database(null, [], { userInsertChanges: 1 }),
        HONOWARDEN_ALLOWED_EMAILS: 'person@example.test',
        HONOWARDEN_BOOTSTRAP_ENABLED: 'true',
        HONOWARDEN_BOOTSTRAP_TOKEN: 'expected-token',
      },
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      object: 'user',
      email: 'person@example.test',
      requestId: 'bootstrap-create-request',
    })
  })

  it('returns conflict for duplicate bootstrap accounts', async () => {
    const response = await app.request(
      '/api/accounts/bootstrap',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-HonoWarden-Bootstrap-Token': 'expected-token',
        },
        body: JSON.stringify({
          email: 'person@example.test',
          masterPasswordHash: 'synthetic-master-password-hash',
        }),
      },
      {
        DB: new FakeD1Database(null, [], { userInsertChanges: 0 }),
        HONOWARDEN_ALLOWED_EMAILS: 'person@example.test',
        HONOWARDEN_BOOTSTRAP_ENABLED: 'true',
        HONOWARDEN_BOOTSTRAP_TOKEN: 'expected-token',
      },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'account_exists',
      },
    })
  })

  it('exchanges a valid password grant for tokens', async () => {
    const database = new FakeD1Database(null, [], {
      authUser: authUserRecord(),
    })
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Device-Identifier': 'fixture-device',
          'Device-Name': 'Fixture Device',
          'Device-Type': '9',
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: 'Person@Example.Test',
          password: 'synthetic-master-password-hash',
          scope: 'api offline_access',
        }),
      },
      {
        DB: database,
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )
    const accountBucketKey = await buildAuthAttemptBucketKey(
      'account',
      'person@example.test',
    )

    expect(response.status).toBe(200)
    expect(database.deletedAuthFailureBucketKeys).toContain(accountBucketKey)
    const body = (await response.json()) as { access_token: string }
    expect(body).toMatchObject({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      token_type: 'Bearer',
      expires_in: 3600,
      Key: '2.synthetic-user-key',
      PrivateKey: '2.synthetic-private-key',
      Kdf: 0,
      KdfIterations: 600000,
      KdfMemory: null,
      KdfParallelism: null,
      AccountKeys: {
        publicKeyEncryptionKeyPair: {
          publicKey: 'synthetic-public-key',
          wrappedPrivateKey: '2.synthetic-private-key',
        },
      },
      ForcePasswordReset: false,
      TwoFactorToken: null,
      MasterPasswordPolicy: null,
      UserDecryptionOptions: {
        HasMasterPassword: true,
        MasterPasswordUnlock: {
          Salt: 'person@example.test',
          Kdf: {
            KdfType: 0,
            Iterations: 600000,
          },
          MasterKeyEncryptedUserKey: '2.synthetic-user-key',
        },
      },
      KeyConnectorUrl: null,
    })
    await expect(
      verifyAccessToken('test-token-secret', body.access_token),
    ).resolves.toMatchObject({
      ok: true,
      claims: {
        authMethod: 'password',
      },
    })
    expect(decodeJwtPayload(body.access_token)).toMatchObject({
      sub: 'user-id',
      email: 'person@example.test',
      email_verified: true,
      name: 'Person',
      premium: false,
      amr: ['Application'],
      device: 'fixture-device',
      sstamp: 'security-stamp',
    })
  })

  it('rejects a password grant superseded before session commit', async () => {
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Device-Identifier': 'fixture-device',
          'Device-Name': 'Fixture Device',
          'Device-Type': '9',
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: 'Person@Example.Test',
          password: 'synthetic-master-password-hash',
          scope: 'api offline_access',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: authUserRecord(),
          deviceUpdateChanges: 0,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_grant',
      ErrorModel: {
        Message: 'Invalid username or password.',
        Object: 'error',
      },
    })
  })

  it('parses premium enablement explicitly and only changes the access-token premium claim', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T00:00:00.000Z'))

    const claimsForFlag = async (flag: string | undefined) => {
      const response = await app.request(
        '/identity/connect/token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Device-Identifier': 'fixture-device',
            'Device-Name': 'Fixture Device',
            'Device-Type': '9',
          },
          body: new URLSearchParams({
            grant_type: 'password',
            username: 'Person@Example.Test',
            password: 'synthetic-master-password-hash',
            scope: 'api offline_access',
          }),
        },
        {
          DB: new FakeD1Database(null, [], {
            authUser: authUserRecord(),
          }),
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
          ...premiumFeatureBinding(flag),
        },
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as { access_token: string }

      return decodeJwtPayload(body.access_token)
    }

    const absentClaims = await claimsForFlag(undefined)
    const falseClaims = await claimsForFlag('false')
    const garbageClaims = await claimsForFlag('yes')
    const enabledClaims = await claimsForFlag('true')
    const normalizedEnabledClaims = await claimsForFlag(' TRUE ')

    expect(absentClaims.premium).toBe(false)
    expect(falseClaims).toEqual(absentClaims)
    expect(garbageClaims).toEqual(absentClaims)
    expect(enabledClaims).toEqual({
      ...absentClaims,
      premium: true,
    })
    expect(normalizedEnabledClaims).toEqual(enabledClaims)
  })

  it('atomically consumes an approved auth request for one device-bound session', async () => {
    const user = authUserRecord()
    const secret = '0123456789abcdef0123456789abcdef'
    const accessCode = 'high-entropy-access-code'
    const row = {
      ...authRequestRecord(),
      status: 'approved',
      requestApproved: 1,
      encryptedResponseKey: 'opaque-encrypted-key',
      responseAt: '2026-07-11T00:05:00.000Z',
      accessCodeHash: await buildAuthRequestAccessCodeHash(
        secret,
        'auth-request-id',
        accessCode,
      ),
    }
    const database = new FakeD1Database(null, [], {
      authUser: user,
      authRequests: [row],
      requestQuotaBucket: unblockedRequestQuotaBucket(),
    })
    const env = {
      DB: database as unknown as D1Database,
      HONOWARDEN_AUTH_REQUESTS_ENABLED: 'true',
      HONOWARDEN_AUTH_REQUEST_SECRET: secret,
      HONOWARDEN_PREMIUM_FEATURES_ENABLED: 'true',
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
    }
    const form = new URLSearchParams({
      grant_type: 'password',
      username: user.email,
      password: accessCode,
      authRequest: 'auth-request-id',
      deviceType: '8',
      deviceIdentifier: 'requester-device',
      deviceName: 'Requester',
    })

    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      },
      env,
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { access_token: string }
    expect(body).toMatchObject({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      token_type: 'Bearer',
    })
    expect(decodeJwtPayload(body.access_token)).toMatchObject({
      sub: user.id,
      device: 'requester-device',
      authMethod: 'auth_request',
      premium: true,
    })
    expect(row.status).toBe('consumed')

    const replay = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      },
      env,
    )
    expect(replay.status).toBe(400)
    await expect(replay.json()).resolves.toMatchObject({
      error: 'invalid_grant',
    })
  })

  it('does not issue a new session from an unlock-only auth request', async () => {
    const user = authUserRecord()
    const secret = '0123456789abcdef0123456789abcdef'
    const accessCode = 'high-entropy-access-code'
    const row = {
      ...authRequestRecord(),
      requestType: 1,
      status: 'approved',
      requestApproved: 1,
      encryptedResponseKey: 'opaque-encrypted-key',
      responseAt: '2026-07-11T00:05:00.000Z',
      accessCodeHash: await buildAuthRequestAccessCodeHash(
        secret,
        'auth-request-id',
        accessCode,
      ),
    }

    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          username: user.email,
          password: accessCode,
          authRequest: 'auth-request-id',
          deviceType: '8',
          deviceIdentifier: 'requester-device',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          authRequests: [row],
          requestQuotaBucket: unblockedRequestQuotaBucket(),
        }) as unknown as D1Database,
        HONOWARDEN_AUTH_REQUESTS_ENABLED: 'true',
        HONOWARDEN_AUTH_REQUEST_SECRET: secret,
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'invalid_grant',
    })
    expect(row.status).toBe('approved')
  })

  it('signs password-grant access tokens with the configured active key id', async () => {
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Device-Identifier': 'fixture-device',
          'Device-Name': 'Fixture Device',
          'Device-Type': '9',
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: 'Person@Example.Test',
          password: 'synthetic-master-password-hash',
          scope: 'api offline_access',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: authUserRecord(),
        }),
        HONOWARDEN_TOKEN_SECRET: 'legacy-token-secret',
        HONOWARDEN_ACCESS_TOKEN_ACTIVE_KID: '2026-07-active',
        HONOWARDEN_ACCESS_TOKEN_ACTIVE_SECRET: 'active-access-secret',
      },
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { access_token: string }
    expect(decodeJwtHeader(body.access_token)).toMatchObject({
      kid: '2026-07-active',
    })
    await expect(
      verifyAccessToken(
        {
          active: {
            id: '2026-07-active',
            secret: 'active-access-secret',
          },
          legacySecrets: ['legacy-token-secret'],
        },
        body.access_token,
      ),
    ).resolves.toMatchObject({
      ok: true,
      keyId: '2026-07-active',
      claims: {
        authMethod: 'password',
      },
    })
  })

  it('returns a TOTP challenge instead of tokens after primary password succeeds', async () => {
    const encryptedSecret = await encryptTotpSecret(
      'test-totp-secret',
      'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    )
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Device-Identifier': 'fixture-device',
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: 'person@example.test',
          password: 'synthetic-master-password-hash',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: {
            ...authUserRecord(),
            totpEnabled: true,
            totpEncryptedSecret: encryptedSecret,
          },
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        HONOWARDEN_TOTP_SECRET: 'test-totp-secret',
      },
    )

    expect(response.status).toBe(400)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      error: 'invalid_grant',
      TwoFactorToken: expect.any(String),
      TwoFactorProviders: [
        {
          type: 'totp',
        },
      ],
    })
    expect(body).not.toHaveProperty('access_token')
    expect(body).not.toHaveProperty('refresh_token')
  })

  it('exchanges a valid password grant with TOTP challenge for tokens', async () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
    const encryptedSecret = await encryptTotpSecret('test-totp-secret', secret)
    const code = await currentTotpCode(secret)
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Device-Identifier': 'fixture-device',
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: 'person@example.test',
          password: 'synthetic-master-password-hash',
          twoFactorProvider: 'totp',
          twoFactorToken: 'totp-challenge-token',
          twoFactorCode: code,
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: {
            ...authUserRecord(),
            totpEnabled: true,
            totpEncryptedSecret: encryptedSecret,
          },
          totpChallenge: {
            id: 'totp-challenge-id',
            userId: 'user-id',
            challengeHash: 'hashed-challenge',
            deviceIdentifier: 'fixture-device',
            expiresAt: '2999-01-01T00:00:00.000Z',
            consumedAt: null,
            createdAt: '2026-07-06T00:00:00.000Z',
          },
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        HONOWARDEN_TOTP_SECRET: 'test-totp-secret',
      },
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { access_token: string }
    expect(body).toMatchObject({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      token_type: 'Bearer',
      TwoFactorToken: null,
    })
    await expect(
      verifyAccessToken('test-token-secret', body.access_token),
    ).resolves.toMatchObject({
      ok: true,
      claims: {
        authMethod: 'password',
      },
    })
  })

  it('accepts official CLI one-step TOTP password grants', async () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
    const encryptedSecret = await encryptTotpSecret('test-totp-secret', secret)
    const code = await currentTotpCode(secret)
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Device-Identifier': 'fixture-device',
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: 'person@example.test',
          password: 'synthetic-master-password-hash',
          twoFactorProvider: '0',
          twoFactorToken: code,
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: {
            ...authUserRecord(),
            totpEnabled: true,
            totpEncryptedSecret: encryptedSecret,
          },
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        HONOWARDEN_TOTP_SECRET: 'test-totp-secret',
      },
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { access_token: string }
    expect(body).toMatchObject({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      token_type: 'Bearer',
      TwoFactorToken: null,
    })
    await expect(
      verifyAccessToken('test-token-secret', body.access_token),
    ).resolves.toMatchObject({
      ok: true,
      claims: {
        authMethod: 'password',
      },
    })
  })

  it('rejects replayed TOTP challenges before issuing tokens', async () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
    const encryptedSecret = await encryptTotpSecret('test-totp-secret', secret)
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Device-Identifier': 'fixture-device',
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: 'person@example.test',
          password: 'synthetic-master-password-hash',
          twoFactorProvider: 'totp',
          twoFactorToken: 'already-consumed-challenge-token',
          twoFactorCode: await currentTotpCode(secret),
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: {
            ...authUserRecord(),
            totpEnabled: true,
            totpEncryptedSecret: encryptedSecret,
          },
          totpChallenge: {
            id: 'totp-challenge-id',
            userId: 'user-id',
            challengeHash: 'hashed-challenge',
            deviceIdentifier: 'fixture-device',
            expiresAt: '2999-01-01T00:00:00.000Z',
            consumedAt: null,
            createdAt: '2026-07-06T00:00:00.000Z',
          },
          totpChallengeUpdateChanges: 0,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        HONOWARDEN_TOTP_SECRET: 'test-totp-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'invalid_grant',
    })
  })

  it('rejects password grant when token secret is missing', async () => {
    const response = await app.request('/identity/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username: 'person@example.test',
        password: 'synthetic-master-password-hash',
      }),
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'server_misconfigured',
      },
    })
  })

  it('fails token exchange closed when active access-token key config is partial', async () => {
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Device-Identifier': 'fixture-device',
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: 'person@example.test',
          password: 'synthetic-master-password-hash',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: authUserRecord(),
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        HONOWARDEN_ACCESS_TOKEN_ACTIVE_KID: '2026-07-active',
      },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'server_misconfigured',
      },
    })
  })

  it('fails token exchange closed when access-token key ids are duplicated', async () => {
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Device-Identifier': 'fixture-device',
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: 'person@example.test',
          password: 'synthetic-master-password-hash',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: authUserRecord(),
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        HONOWARDEN_ACCESS_TOKEN_ACTIVE_KID: '2026-07-active',
        HONOWARDEN_ACCESS_TOKEN_ACTIVE_SECRET: 'active-access-secret',
        HONOWARDEN_ACCESS_TOKEN_PREVIOUS_KEYS: JSON.stringify([
          {
            kid: '2026-07-active',
            secret: 'previous-access-secret',
          },
        ]),
      },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'server_misconfigured',
      },
    })
  })

  it('requires device information for password grant', async () => {
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: 'person@example.test',
          password: 'synthetic-master-password-hash',
        }),
      },
      {
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'invalid_request',
      ErrorModel: {
        Message: 'Device information is required.',
      },
    })
  })

  it('rejects invalid password grants without revealing user existence', async () => {
    const cleanup = vi
      .spyOn(retentionCleanup, 'cleanupTransientAuthData')
      .mockResolvedValue()

    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Device-Identifier': 'fixture-device',
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: 'person@example.test',
          password: 'wrong-master-password-hash',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: authUserRecord(),
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_grant',
      ErrorModel: {
        Message: 'Invalid username or password.',
        Object: 'error',
      },
    })
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(cleanup).toHaveBeenCalledWith(
      expect.any(FakeD1Database),
      expect.any(String),
      {
        auditEvents: false,
      },
    )
  })

  it('rejects password grants for disabled users without revealing account state', async () => {
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Device-Identifier': 'fixture-device',
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: 'person@example.test',
          password: 'synthetic-master-password-hash',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: {
            ...authUserRecord(),
            disabledAt: '2026-07-06T00:00:00.000Z',
          },
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_grant',
      ErrorModel: {
        Message: 'Invalid username or password.',
        Object: 'error',
      },
    })
  })

  it('emits a secret-safe audit event for failed password grants when enabled', async () => {
    const auditLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Device-Identifier': 'fixture-device',
          'X-Request-Id': 'audit-password-failure-request',
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: 'person@example.test',
          password: 'wrong-master-password-hash',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: authUserRecord(),
        }),
        HONOWARDEN_AUDIT_LOGS: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    expect(auditLog).toHaveBeenCalledTimes(1)
    const event = JSON.parse(auditLog.mock.calls[0]?.[0] ?? '{}')
    expect(event).toMatchObject({
      object: 'auditEvent',
      schemaVersion: 1,
      name: 'auth.password_grant',
      outcome: 'failure',
      requestId: 'audit-password-failure-request',
      actor: {
        userId: 'user-id',
        deviceIdentifier: 'fixture-device',
      },
      context: {
        reason: 'invalid_grant',
      },
    })
    expect(JSON.stringify(event)).not.toContain('wrong-master-password-hash')
    expect(JSON.stringify(event)).not.toContain('test-token-secret')
  })

  it('persists a secret-safe audit event for failed password grants when enabled', async () => {
    const auditLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    const database = new FakeD1Database(null, [], {
      authUser: authUserRecord(),
    })
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Device-Identifier': 'fixture-device',
          'X-Request-Id': 'audit-password-persist-request',
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: 'person@example.test',
          password: 'wrong-master-password-hash',
        }),
      },
      {
        DB: database,
        HONOWARDEN_AUDIT_LOGS: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    expect(auditLog).toHaveBeenCalledTimes(1)
    expect(database.auditEventInserts).toHaveLength(1)
    expect(database.auditEventInserts[0]).toMatchObject({
      schemaVersion: 1,
      name: 'auth.password_grant',
      outcome: 'failure',
      requestId: 'audit-password-persist-request',
      actorUserId: 'user-id',
      actorDeviceIdentifier: 'fixture-device',
      targetType: null,
      targetId: null,
      contextJson: JSON.stringify({
        reason: 'invalid_grant',
      }),
    })
    const persisted = JSON.stringify(database.auditEventInserts[0])
    expect(persisted).not.toContain('wrong-master-password-hash')
    expect(persisted).not.toContain('test-token-secret')
  })

  it('fails loudly when opt-in audit persistence cannot write', async () => {
    const auditLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Device-Identifier': 'fixture-device',
          'X-Request-Id': 'audit-password-persist-failure-request',
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: 'person@example.test',
          password: 'wrong-master-password-hash',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: authUserRecord(),
          auditEventInsertThrows: true,
        }),
        HONOWARDEN_AUDIT_LOGS: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(503)
    expect(auditLog).toHaveBeenCalledTimes(1)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'database_unavailable',
      },
      requestId: 'audit-password-persist-failure-request',
    })
  })

  it('temporarily rate limits password grants from an over-limit client address', async () => {
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'CF-Connecting-IP': '203.0.113.10',
          'Device-Identifier': 'fixture-device',
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: 'person@example.test',
          password: 'synthetic-master-password-hash',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: authUserRecord(),
          lockedIpFailureBucket: true,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe(
      String(loginDefensePolicy.ipRetryAfterSeconds),
    )
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_grant',
      ErrorModel: {
        Message: 'Invalid username or password.',
        Object: 'error',
      },
    })
  })

  it('rejects password grants for temporarily locked accounts without revealing lock state', async () => {
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Device-Identifier': 'fixture-device',
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: 'person@example.test',
          password: 'synthetic-master-password-hash',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: {
            ...authUserRecord(),
            loginFailedCount: loginDefensePolicy.accountFailureLimit,
            loginFailedAt: '2026-07-06T00:05:00.000Z',
            loginLockedUntil: '2999-07-06T00:20:00.000Z',
          },
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_grant',
      ErrorModel: {
        Message: 'Invalid username or password.',
        Object: 'error',
      },
    })
  })

  it('rotates refresh tokens for a valid refresh grant', async () => {
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: 'synthetic-refresh-token',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          refreshSession: refreshTokenSessionRecord(),
          refreshRotationChanges: 1,
        }),
        HONOWARDEN_PREMIUM_FEATURES_ENABLED: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { access_token: string }
    expect(body).toMatchObject({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      token_type: 'Bearer',
      expires_in: 3600,
      Key: '2.synthetic-user-key',
      PrivateKey: '2.synthetic-private-key',
      AccountKeys: {
        object: 'privateKeys',
        publicKeyEncryptionKeyPair: {
          object: 'publicKeyEncryptionKeyPair',
          publicKey: 'synthetic-public-key',
          wrappedPrivateKey: '2.synthetic-private-key',
          signedPublicKey: null,
        },
        securityState: null,
      },
      Kdf: 0,
      KdfIterations: 600000,
    })
    await expect(
      verifyAccessToken('test-token-secret', body.access_token),
    ).resolves.toMatchObject({
      ok: true,
      claims: {
        authMethod: 'refresh',
        premium: true,
      },
    })
  })

  it('rejects partial account keys before rotating a refresh token', async () => {
    const database = new FakeD1Database(null, [], {
      refreshSession: {
        ...refreshTokenSessionRecord(),
        publicKey: 'synthetic-surviving-public-key',
        privateKey: null,
      },
      refreshRotationChanges: 1,
    })
    const prepare = vi.spyOn(database, 'prepare')

    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: 'synthetic-refresh-token',
        }),
      },
      {
        DB: database,
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body).toEqual({
      error: {
        code: 'database_unavailable',
        message: 'Token exchange failed.',
      },
      requestId: expect.any(String),
    })
    expect(JSON.stringify(body)).not.toContain('synthetic-surviving-public-key')
    expect(
      prepare.mock.calls.some(([query]) =>
        /UPDATE\s+refresh_tokens/.test(String(query)),
      ),
    ).toBe(false)
  })

  it('projects stored Argon2id settings through refresh-token responses', async () => {
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: 'synthetic-refresh-token',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          refreshSession: {
            ...refreshTokenSessionRecord(),
            kdfAlgorithm: 'argon2id',
            kdfIterations: 6,
            kdfMemory: 32,
            kdfParallelism: 4,
          },
          refreshRotationChanges: 1,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      Kdf: 1,
      KdfIterations: 6,
      KdfMemory: 32,
      KdfParallelism: 4,
      UserDecryptionOptions: {
        MasterPasswordUnlock: {
          Kdf: {
            KdfType: 1,
            Iterations: 6,
            Memory: 32,
            Parallelism: 4,
          },
        },
      },
    })
  })

  it('signs refresh-grant access tokens with the configured active key id', async () => {
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: 'synthetic-refresh-token',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          refreshSession: refreshTokenSessionRecord(),
          refreshRotationChanges: 1,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        HONOWARDEN_ACCESS_TOKEN_ACTIVE_KID: '2026-07-active',
        HONOWARDEN_ACCESS_TOKEN_ACTIVE_SECRET: 'active-access-secret',
      },
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as { access_token: string }
    expect(decodeJwtHeader(body.access_token)).toMatchObject({
      kid: '2026-07-active',
    })
    await expect(
      verifyAccessToken(
        {
          active: {
            id: '2026-07-active',
            secret: 'active-access-secret',
          },
          legacySecrets: ['test-token-secret'],
        },
        body.access_token,
      ),
    ).resolves.toMatchObject({
      ok: true,
      keyId: '2026-07-active',
      claims: {
        authMethod: 'refresh',
      },
    })
  })

  it('invalidates a refresh token session when a revoked token is reused', async () => {
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: 'synthetic-refresh-token',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          refreshSession: {
            ...refreshTokenSessionRecord(),
            tokenRevokedAt: '2026-07-06T00:00:00.000Z',
          },
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_grant',
      ErrorModel: {
        Message: 'Invalid username or password.',
        Object: 'error',
      },
    })
  })

  it('rejects refresh grants for revoked devices', async () => {
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: 'synthetic-refresh-token',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          refreshSession: {
            ...refreshTokenSessionRecord(),
            deviceRevokedAt: '2026-07-06T00:00:00.000Z',
          },
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'invalid_grant',
    })
  })

  it('rejects refresh grants for disabled users before rotating tokens', async () => {
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: 'synthetic-refresh-token',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          refreshSession: {
            ...refreshTokenSessionRecord(),
            disabledAt: '2026-07-06T00:00:00.000Z',
          },
          refreshRotationChanges: 0,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'invalid_grant',
    })
  })

  it('rejects unknown refresh tokens without session changes', async () => {
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: 'unknown-refresh-token',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          refreshSession: null,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'invalid_grant',
    })
  })

  it('returns 503 for sync when token secret is missing', async () => {
    const response = await app.request('/api/sync', {
      headers: {
        Authorization: 'Bearer synthetic-access-token',
        'X-Request-Id': 'sync-missing-secret-request',
      },
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'server_misconfigured',
      },
      requestId: 'sync-missing-secret-request',
    })
  })

  it('accepts previous access-token signing keys during staged rotation', async () => {
    const user = authUserRecord()
    const accessToken = await signAccessToken(
      { id: '2026-06-previous', secret: 'previous-access-secret' },
      {
        sub: user.id,
        email: user.emailNormalized,
        device: 'fixture-device',
        securityStamp: user.securityStamp,
        iat: 1,
        exp: 4_102_444_800,
      },
    )
    const response = await app.request(
      '/api/sync',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        HONOWARDEN_ACCESS_TOKEN_ACTIVE_KID: '2026-07-active',
        HONOWARDEN_ACCESS_TOKEN_ACTIVE_SECRET: 'active-access-secret',
        HONOWARDEN_ACCESS_TOKEN_PREVIOUS_KEYS: JSON.stringify([
          {
            kid: '2026-06-previous',
            secret: 'previous-access-secret',
          },
        ]),
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: 'sync',
      profile: {
        id: user.id,
      },
    })
  })

  it('keeps legacy no-kid access tokens valid during staged rotation', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/sync',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        HONOWARDEN_ACCESS_TOKEN_ACTIVE_KID: '2026-07-active',
        HONOWARDEN_ACCESS_TOKEN_ACTIVE_SECRET: 'active-access-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: 'sync',
      profile: {
        id: user.id,
      },
    })
  })

  it('fails authenticated routes closed when previous access-token keys are malformed', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/sync',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'sync-malformed-previous-keys-request',
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        HONOWARDEN_ACCESS_TOKEN_ACTIVE_KID: '2026-07-active',
        HONOWARDEN_ACCESS_TOKEN_ACTIVE_SECRET: 'active-access-secret',
        HONOWARDEN_ACCESS_TOKEN_PREVIOUS_KEYS: 'not-json',
      },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'server_misconfigured',
      },
      requestId: 'sync-malformed-previous-keys-request',
    })
  })

  it('requires bearer authorization for sync', async () => {
    const response = await app.request(
      '/api/sync',
      {
        headers: {
          'X-Request-Id': 'sync-missing-token-request',
        },
      },
      {
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'missing_token',
      },
      requestId: 'sync-missing-token-request',
    })
  })

  it('rejects invalid access tokens for sync', async () => {
    const response = await app.request(
      '/api/sync',
      {
        headers: {
          Authorization: 'Bearer invalid-token',
          'X-Request-Id': 'sync-invalid-token-request',
        },
      },
      {
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_token',
      },
      requestId: 'sync-invalid-token-request',
    })
  })

  it('exports an owner-scoped user backup after recent password authentication', async () => {
    const alice = {
      ...authUserRecord(),
      id: 'alice-id',
      email: 'Alice@Example.Test',
      emailNormalized: 'alice@example.test',
      displayName: 'Alice',
      userKey: '2.alice-user-key',
      publicKey: 'alice-public-key',
      privateKey: '2.alice-private-key',
      securityStamp: 'alice-security-stamp',
    }
    const bob = {
      ...authUserRecord(),
      id: 'bob-id',
      email: 'Bob@Example.Test',
      emailNormalized: 'bob@example.test',
      displayName: 'Bob',
      userKey: '2.bob-user-key',
      securityStamp: 'bob-security-stamp',
    }
    const accessToken = await recentPasswordAccessTokenFor(alice)
    const response = await app.request(
      '/api/accounts/export',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'backup-export-request',
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUsers: [alice, bob],
          folders: [
            {
              id: 'alice-folder-id',
              userId: 'alice-id',
              name: '2.alice-encrypted-folder',
              revisionDate: '2026-07-06T00:03:00.000Z',
            },
            {
              id: 'bob-folder-id',
              userId: 'bob-id',
              name: '2.bob-encrypted-folder',
              revisionDate: '2026-07-06T00:04:00.000Z',
            },
          ],
          ciphers: [
            {
              id: 'alice-cipher-id',
              userId: 'alice-id',
              folderId: 'alice-folder-id',
              type: 1,
              favorite: 1,
              encryptedJson: JSON.stringify({
                ...cipherCreateBody(),
                folderId: 'alice-folder-id',
                name: '2.alice-encrypted-cipher',
              }),
              revisionDate: '2026-07-06T00:05:00.000Z',
              createdAt: '2026-07-06T00:04:00.000Z',
            },
            {
              id: 'bob-cipher-id',
              userId: 'bob-id',
              folderId: 'bob-folder-id',
              type: 1,
              favorite: 0,
              encryptedJson: JSON.stringify({
                ...cipherCreateBody(),
                folderId: 'bob-folder-id',
                name: '2.bob-encrypted-cipher',
              }),
              revisionDate: '2026-07-06T00:06:00.000Z',
              createdAt: '2026-07-06T00:04:00.000Z',
            },
          ],
          attachments: [
            {
              ...attachmentRecord(),
              id: 'alice-attachment-id',
              userId: 'alice-id',
              cipherId: 'alice-cipher-id',
              objectKey: 'attachments/alice-object-key',
              fileName: '2.alice-encrypted-file',
              attachmentKey: '2.alice-attachment-key',
            },
            {
              ...attachmentRecord(),
              id: 'bob-attachment-id',
              userId: 'bob-id',
              cipherId: 'bob-cipher-id',
              objectKey: 'attachments/bob-object-key',
              fileName: '2.bob-encrypted-file',
              attachmentKey: '2.bob-attachment-key',
            },
          ],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Content-Disposition')).toContain(
      'honowarden-export-',
    )
    const payload = (await response.json()) as Record<string, unknown>
    expect(payload).toMatchObject({
      object: 'backupExport',
      schemaVersion: 1,
      requestId: 'backup-export-request',
      source: {
        service: 'honowarden',
        version: '0.1.0-alpha',
      },
      account: {
        id: 'alice-id',
        email: 'alice@example.test',
        name: 'Alice',
        key: '2.alice-user-key',
        privateKey: '2.alice-private-key',
        twoFactorEnabled: false,
        kdf: {
          algorithm: 'pbkdf2-sha256',
          iterations: 600000,
        },
      },
      folders: [
        {
          id: 'alice-folder-id',
          name: '2.alice-encrypted-folder',
        },
      ],
      ciphers: [
        {
          id: 'alice-cipher-id',
          folderId: 'alice-folder-id',
          name: '2.alice-encrypted-cipher',
          attachments: [
            {
              id: 'alice-attachment-id',
              fileName: '2.alice-encrypted-file',
              key: '2.alice-attachment-key',
              size: '15',
              sizeName: '15 B',
            },
          ],
        },
      ],
      attachments: [
        {
          id: 'alice-attachment-id',
          cipherId: 'alice-cipher-id',
          fileName: '2.alice-encrypted-file',
          key: '2.alice-attachment-key',
          size: '15',
          sizeName: '15 B',
        },
      ],
      limits: {
        rawR2ObjectBodies: 'excluded',
        operatorBackupPath: 'pnpm backup:export',
      },
    })
    expect(payload).toHaveProperty('generatedAt')

    const backup = payload as {
      ciphers: Array<{ attachments?: unknown[] }>
      attachments: unknown[]
    }
    expectOfficialAttachmentFieldTypes(backup.ciphers[0]?.attachments?.[0])
    expect(typeof (backup.attachments[0] as Record<string, unknown>).size).toBe(
      'string',
    )
    expect(
      typeof (backup.attachments[0] as Record<string, unknown>).sizeName,
    ).toBe('string')

    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('bob')
    expect(serialized).not.toContain('masterPasswordHash')
    expect(serialized).not.toContain('synthetic-master-password-hash')
    expect(serialized).not.toContain('test-token-secret')
    expect(serialized).not.toContain('securityStamp')
    expect(serialized).not.toContain('alice-security-stamp')
    expect(serialized).not.toContain('objectKey')
    expect(serialized).not.toContain('attachments/alice-object-key')
  })

  it('requires recent password authentication before user backup export', async () => {
    const user = authUserRecord()
    const accessToken = await refreshAccessTokenFor(user)
    const response = await app.request(
      '/api/accounts/export',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'backup-export-reauth-request',
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'reauth_required',
      },
      requestId: 'backup-export-reauth-request',
    })
  })

  it('emits a secret-safe audit event for user backup export', async () => {
    const auditLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    const user = authUserRecord()
    const accessToken = await recentPasswordAccessTokenFor(user)
    const response = await app.request(
      '/api/accounts/export',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'audit-backup-export-request',
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          folders: [
            {
              id: 'folder-id',
              userId: 'user-id',
              name: '2.encrypted-folder',
              revisionDate: '2026-07-06T00:03:00.000Z',
            },
          ],
          ciphers: [
            {
              id: 'cipher-id',
              userId: 'user-id',
              folderId: 'folder-id',
              type: 1,
              favorite: 1,
              encryptedJson: JSON.stringify(cipherCreateBody()),
              revisionDate: '2026-07-06T00:05:00.000Z',
              createdAt: '2026-07-06T00:04:00.000Z',
            },
          ],
          attachments: [attachmentRecord()],
        }),
        HONOWARDEN_AUDIT_LOGS: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    expect(auditLog).toHaveBeenCalledTimes(1)
    const event = JSON.parse(auditLog.mock.calls[0]?.[0] ?? '{}')
    expect(event).toMatchObject({
      object: 'auditEvent',
      schemaVersion: 1,
      name: 'backup.export',
      outcome: 'success',
      requestId: 'audit-backup-export-request',
      actor: {
        userId: 'user-id',
        deviceIdentifier: 'fixture-device',
      },
      target: {
        type: 'backup',
        id: 'user-id',
      },
      context: {
        folderCount: 1,
        cipherCount: 1,
        attachmentCount: 1,
        rawR2ObjectBodiesIncluded: false,
      },
    })
    const serialized = JSON.stringify(event)
    expect(serialized).not.toContain(accessToken)
    expect(serialized).not.toContain('test-token-secret')
    expect(serialized).not.toContain('synthetic-master-password-hash')
    expect(serialized).not.toContain('2.encrypted')
  })

  it('sets up TOTP for an authenticated user', async () => {
    const user = authUserRecord()
    const accessToken = await recentPasswordAccessTokenFor(user)
    const response = await app.request(
      '/identity/accounts/totp/setup',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        HONOWARDEN_TOTP_SECRET: 'test-totp-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: 'totpSetup',
      enabled: false,
      secret: expect.stringMatching(/^[A-Z2-7]{32}$/),
      uri: expect.stringContaining('otpauth://totp/'),
    })
  })

  it('fails closed when TOTP setup secret wrapping is not configured', async () => {
    const user = authUserRecord()
    const accessToken = await recentPasswordAccessTokenFor(user)
    const response = await app.request(
      '/identity/accounts/totp/setup',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'server_misconfigured',
      },
    })
  })

  it('rejects TOTP setup when TOTP is already enabled', async () => {
    const user = {
      ...authUserRecord(),
      totpEnabled: true,
      totpEncryptedSecret: 'v1.encrypted-totp-secret',
      totpLastAcceptedStep: 59440320,
    }
    const accessToken = await recentPasswordAccessTokenFor(user)
    const response = await app.request(
      '/identity/accounts/totp/setup',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'totp-setup-already-enabled-request',
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
        message: 'TOTP is already enabled.',
      },
      requestId: 'totp-setup-already-enabled-request',
    })
  })

  it('verifies TOTP setup and enables the user flag', async () => {
    const user = authUserRecord()
    const accessToken = await recentPasswordAccessTokenFor(user)
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
    const encryptedSecret = await encryptTotpSecret('test-totp-secret', secret)
    const response = await app.request(
      '/identity/accounts/totp/setup/verify',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: await currentTotpCode(secret),
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          userTotp: {
            userId: 'user-id',
            encryptedSecret,
            enabled: 0,
            verifiedAt: null,
            lastAcceptedStep: null,
            createdAt: '2026-07-06T00:00:00.000Z',
            updatedAt: '2026-07-06T00:00:00.000Z',
          },
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        HONOWARDEN_TOTP_SECRET: 'test-totp-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      object: 'totp',
      enabled: true,
    })
  })

  it('requires recent password authentication for TOTP setup', async () => {
    const user = authUserRecord()
    const accessToken = await stalePasswordAccessTokenFor(user)
    const response = await app.request(
      '/identity/accounts/totp/setup',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'stale-totp-setup-request',
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        HONOWARDEN_TOTP_SECRET: 'test-totp-secret',
      },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'reauth_required',
      },
      requestId: 'stale-totp-setup-request',
    })
  })

  it('rejects legacy claimless access tokens for TOTP setup', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/identity/accounts/totp/setup',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        HONOWARDEN_TOTP_SECRET: 'test-totp-secret',
      },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'reauth_required',
      },
    })
  })

  it('rejects refresh-issued access tokens for TOTP setup verification', async () => {
    const user = authUserRecord()
    const accessToken = await refreshAccessTokenFor(user)
    const response = await app.request(
      '/identity/accounts/totp/setup/verify',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: '123456',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        HONOWARDEN_TOTP_SECRET: 'test-totp-secret',
      },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'reauth_required',
      },
    })
  })

  it('disables TOTP for a recent password-authenticated user', async () => {
    const user = {
      ...authUserRecord(),
      totpEnabled: true,
      totpEncryptedSecret: 'v1.encrypted-totp-secret',
      totpLastAcceptedStep: 59440320,
    }
    const accessToken = await recentPasswordAccessTokenFor(user)
    const response = await app.request(
      '/identity/accounts/totp/disable',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      object: 'totp',
      enabled: false,
    })
  })

  it('requires recent password authentication before disabling TOTP', async () => {
    const user = {
      ...authUserRecord(),
      totpEnabled: true,
      totpEncryptedSecret: 'v1.encrypted-totp-secret',
      totpLastAcceptedStep: 59440320,
    }
    const accessToken = await refreshAccessTokenFor(user)
    const response = await app.request(
      '/identity/accounts/totp/disable',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'totp-disable-reauth-request',
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'reauth_required',
      },
      requestId: 'totp-disable-reauth-request',
    })
  })

  it('returns a stable error when disabling missing TOTP setup', async () => {
    const user = authUserRecord()
    const accessToken = await recentPasswordAccessTokenFor(user)
    const response = await app.request(
      '/identity/accounts/totp/disable',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'missing-totp-disable-request',
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          userTotpDeleteChanges: 0,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
      },
      requestId: 'missing-totp-disable-request',
    })
  })

  it('emits a secret-safe audit event when TOTP disable has no enabled setup', async () => {
    const auditLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    const user = authUserRecord()
    const accessToken = await recentPasswordAccessTokenFor(user)
    const response = await app.request(
      '/identity/accounts/totp/disable',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'audit-missing-totp-disable-request',
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_AUDIT_LOGS: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    expect(auditLog).toHaveBeenCalledTimes(1)
    const event = JSON.parse(auditLog.mock.calls[0]?.[0] ?? '{}')
    expect(event).toMatchObject({
      object: 'auditEvent',
      schemaVersion: 1,
      name: 'totp.disable',
      outcome: 'failure',
      requestId: 'audit-missing-totp-disable-request',
      actor: {
        userId: 'user-id',
        deviceIdentifier: 'fixture-device',
      },
      target: {
        type: 'account',
        id: 'user-id',
      },
      context: {
        reason: 'not_enabled',
      },
    })
    expect(JSON.stringify(event)).not.toContain(accessToken)
    expect(JSON.stringify(event)).not.toContain('test-token-secret')
  })

  it('emits a secret-safe audit event when disabling TOTP', async () => {
    const auditLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    const user = {
      ...authUserRecord(),
      totpEnabled: true,
      totpEncryptedSecret: 'v1.encrypted-totp-secret',
      totpLastAcceptedStep: 59440320,
    }
    const accessToken = await recentPasswordAccessTokenFor(user)
    const response = await app.request(
      '/identity/accounts/totp/disable',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'audit-totp-disable-request',
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_AUDIT_LOGS: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    expect(auditLog).toHaveBeenCalledTimes(1)
    const event = JSON.parse(auditLog.mock.calls[0]?.[0] ?? '{}')
    expect(event).toMatchObject({
      object: 'auditEvent',
      schemaVersion: 1,
      name: 'totp.disable',
      outcome: 'success',
      requestId: 'audit-totp-disable-request',
      actor: {
        userId: 'user-id',
        deviceIdentifier: 'fixture-device',
      },
      target: {
        type: 'account',
        id: 'user-id',
      },
      context: {
        enabled: false,
      },
    })
    expect(JSON.stringify(event)).not.toContain(accessToken)
    expect(JSON.stringify(event)).not.toContain('v1.encrypted-totp-secret')
    expect(JSON.stringify(event)).not.toContain('test-token-secret')
  })

  it('starts TOTP change after recent password authentication and current TOTP verification', async () => {
    const currentSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
    const encryptedSecret = await encryptTotpSecret(
      'test-totp-secret',
      currentSecret,
    )
    const user = {
      ...authUserRecord(),
      totpEnabled: true,
      totpEncryptedSecret: encryptedSecret,
      totpLastAcceptedStep: null,
    }
    const accessToken = await recentPasswordAccessTokenFor(user)
    const response = await app.request(
      '/identity/accounts/totp/change',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentCode: await currentTotpCode(currentSecret),
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          userTotp: {
            userId: 'user-id',
            encryptedSecret,
            enabled: 1,
            verifiedAt: '2026-07-06T00:01:00.000Z',
            lastAcceptedStep: null,
            pendingEncryptedSecret: null,
            pendingCreatedAt: null,
            createdAt: '2026-07-06T00:00:00.000Z',
            updatedAt: '2026-07-06T00:01:00.000Z',
          },
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        HONOWARDEN_TOTP_SECRET: 'test-totp-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: 'totpChange',
      enabled: true,
      pendingVerification: true,
      secret: expect.stringMatching(/^[A-Z2-7]{32}$/),
      uri: expect.stringContaining('otpauth://totp/'),
    })
  })

  it('requires recent password authentication before changing TOTP', async () => {
    const currentSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
    const encryptedSecret = await encryptTotpSecret(
      'test-totp-secret',
      currentSecret,
    )
    const user = {
      ...authUserRecord(),
      totpEnabled: true,
      totpEncryptedSecret: encryptedSecret,
      totpLastAcceptedStep: null,
    }
    const accessToken = await refreshAccessTokenFor(user)
    const response = await app.request(
      '/identity/accounts/totp/change',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'totp-change-reauth-request',
        },
        body: JSON.stringify({
          currentCode: await currentTotpCode(currentSecret),
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        HONOWARDEN_TOTP_SECRET: 'test-totp-secret',
      },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'reauth_required',
      },
      requestId: 'totp-change-reauth-request',
    })
  })

  it('rejects invalid current TOTP codes before starting TOTP change', async () => {
    const currentSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
    const encryptedSecret = await encryptTotpSecret(
      'test-totp-secret',
      currentSecret,
    )
    const user = {
      ...authUserRecord(),
      totpEnabled: true,
      totpEncryptedSecret: encryptedSecret,
      totpLastAcceptedStep: null,
    }
    const accessToken = await recentPasswordAccessTokenFor(user)
    const response = await app.request(
      '/identity/accounts/totp/change',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'totp-change-invalid-code-request',
        },
        body: JSON.stringify({
          currentCode: '000000',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          userTotp: {
            userId: 'user-id',
            encryptedSecret,
            enabled: 1,
            verifiedAt: '2026-07-06T00:01:00.000Z',
            lastAcceptedStep: null,
            pendingEncryptedSecret: null,
            pendingCreatedAt: null,
            createdAt: '2026-07-06T00:00:00.000Z',
            updatedAt: '2026-07-06T00:01:00.000Z',
          },
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        HONOWARDEN_TOTP_SECRET: 'test-totp-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
        message: 'TOTP code is invalid.',
      },
      requestId: 'totp-change-invalid-code-request',
    })
  })

  it('verifies and promotes a pending TOTP change', async () => {
    const pendingSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXQ'
    const pendingEncryptedSecret = await encryptTotpSecret(
      'test-totp-secret',
      pendingSecret,
    )
    const user = {
      ...authUserRecord(),
      totpEnabled: true,
      totpEncryptedSecret: 'v1.current-encrypted-secret',
      totpLastAcceptedStep: 59440320,
    }
    const accessToken = await recentPasswordAccessTokenFor(user)
    const response = await app.request(
      '/identity/accounts/totp/change/verify',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: await currentTotpCode(pendingSecret),
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          userTotp: {
            userId: 'user-id',
            encryptedSecret: 'v1.current-encrypted-secret',
            enabled: 1,
            verifiedAt: '2026-07-06T00:01:00.000Z',
            lastAcceptedStep: 59440320,
            pendingEncryptedSecret,
            pendingCreatedAt: '2026-07-06T00:02:00.000Z',
            createdAt: '2026-07-06T00:00:00.000Z',
            updatedAt: '2026-07-06T00:02:00.000Z',
          },
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        HONOWARDEN_TOTP_SECRET: 'test-totp-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      object: 'totp',
      enabled: true,
    })
  })

  it('rejects TOTP change verify replay when no pending change remains', async () => {
    const pendingSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXQ'
    const user = {
      ...authUserRecord(),
      totpEnabled: true,
      totpEncryptedSecret: 'v1.current-encrypted-secret',
      totpLastAcceptedStep: 59440320,
    }
    const accessToken = await recentPasswordAccessTokenFor(user)
    const response = await app.request(
      '/identity/accounts/totp/change/verify',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'totp-change-replay-request',
        },
        body: JSON.stringify({
          code: await currentTotpCode(pendingSecret),
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          userTotp: {
            userId: 'user-id',
            encryptedSecret: 'v1.current-encrypted-secret',
            enabled: 1,
            verifiedAt: '2026-07-06T00:01:00.000Z',
            lastAcceptedStep: 59440320,
            pendingEncryptedSecret: null,
            pendingCreatedAt: null,
            createdAt: '2026-07-06T00:00:00.000Z',
            updatedAt: '2026-07-06T00:02:00.000Z',
          },
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        HONOWARDEN_TOTP_SECRET: 'test-totp-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
        message: 'TOTP change not found.',
      },
      requestId: 'totp-change-replay-request',
    })
  })

  it('returns an empty personal vault sync for a valid access token', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/sync',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown> & {
      profile: Record<string, unknown>
      domains: Record<string, unknown>
      userDecryption: {
        masterPasswordUnlock: {
          kdf: Record<string, unknown>
        } & Record<string, unknown>
      } & Record<string, unknown>
    }
    expect(body).toMatchObject({
      object: 'sync',
      profile: {
        id: 'user-id',
        name: 'Person',
        email: 'person@example.test',
        emailVerified: true,
        premium: false,
        premiumFromOrganization: false,
        culture: 'en-US',
        twoFactorEnabled: false,
        key: '2.synthetic-user-key',
        accountKeys: {
          signatureKeyPair: null,
          publicKeyEncryptionKeyPair: {
            publicKey: 'synthetic-public-key',
            wrappedPrivateKey: '2.synthetic-private-key',
            signedPublicKey: null,
          },
          securityState: null,
        },
        avatarColor: '#3366cc',
        creationDate: '2026-07-06T00:00:00.000Z',
        privateKey: '2.synthetic-private-key',
        securityStamp: 'security-stamp',
        forcePasswordReset: false,
        usesKeyConnector: false,
        organizations: [],
        organizationsNew: [],
        providers: [],
        providerOrganizations: [],
        masterPasswordHint: null,
      },
      folders: [],
      collections: [],
      ciphers: [],
      domains: {
        equivalentDomains: [],
        globalEquivalentDomains: [],
      },
      policies: [],
      policiesNew: [],
      sends: [],
      userDecryption: {
        masterPasswordUnlock: {
          salt: 'person@example.test',
          kdf: {
            kdfType: 0,
            iterations: 600000,
            memory: null,
            parallelism: null,
          },
          masterKeyEncryptedUserKey: '2.synthetic-user-key',
        },
      },
    })
    expect(body).not.toHaveProperty('Profile')
    expect(body).not.toHaveProperty('Domains')
    expect(body).not.toHaveProperty('UserDecryption')
    expect(body.profile).not.toHaveProperty('Id')
    expect(body.profile).not.toHaveProperty('Email')
    expect(body.profile).not.toHaveProperty('AccountKeys')
    expect(body.domains).not.toHaveProperty('EquivalentDomains')
    expect(body.domains).not.toHaveProperty('GlobalEquivalentDomains')
    expect(body.userDecryption).not.toHaveProperty('MasterPasswordUnlock')
    expect(body.userDecryption.masterPasswordUnlock).not.toHaveProperty('Salt')
    expect(body.userDecryption.masterPasswordUnlock).not.toHaveProperty('Kdf')
    expect(body.userDecryption.masterPasswordUnlock).not.toHaveProperty(
      'MasterKeyEncryptedUserKey',
    )
    expect(body.userDecryption.masterPasswordUnlock).not.toHaveProperty(
      'masterKeyWrappedUserKey',
    )
    expect(body.userDecryption.masterPasswordUnlock.kdf).not.toHaveProperty(
      'KdfType',
    )
  })

  it('normalizes SQLite timestamps in sync profile dates for mobile clients', async () => {
    const user = {
      ...authUserRecord(),
      createdAt: '2026-07-10 01:05:47',
    }
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/sync',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      profile: {
        creationDate: string
      }
    }
    expect(body.profile.creationDate).toBe('2026-07-10T01:05:47.000Z')
  })

  it('returns empty policy metadata for authenticated users', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)

    for (const path of ['/api/policies', '/api/policies/new']) {
      const response = await app.request(
        path,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
        {
          DB: new FakeD1Database(null, [], {
            authUser: user,
          }),
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        },
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        object: 'list',
        data: [],
        continuationToken: null,
      })
    }
  })

  it('returns domain metadata aliases for authenticated users', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)

    for (const path of ['/api/domains', '/api/settings/domains']) {
      const response = await app.request(
        path,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
        {
          DB: new FakeD1Database(null, [], {
            authUser: user,
          }),
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        },
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        equivalentDomains: [],
        globalEquivalentDomains: [],
        EquivalentDomains: [],
        GlobalEquivalentDomains: [],
      })
    }
  })

  it('returns configured equivalent domains consistently for metadata aliases and sync', async () => {
    const user = {
      ...authUserRecord(),
      equivalentDomainsJson: JSON.stringify([
        ['example.com', 'example.net'],
        ['service.test', 'login.service.test'],
      ]),
      excludedGlobalEquivalentDomainsJson: JSON.stringify([1]),
    }
    const accessToken = await accessTokenFor(user)
    const env = {
      DB: new FakeD1Database(null, [], {
        authUser: user,
      }),
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
    }

    for (const path of ['/api/domains', '/api/settings/domains']) {
      const response = await app.request(
        path,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
        env,
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        equivalentDomains: [
          ['example.com', 'example.net'],
          ['service.test', 'login.service.test'],
        ],
        globalEquivalentDomains: [],
        EquivalentDomains: [
          ['example.com', 'example.net'],
          ['service.test', 'login.service.test'],
        ],
        GlobalEquivalentDomains: [],
      })
    }

    const syncResponse = await app.request(
      '/api/sync',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      env,
    )

    expect(syncResponse.status).toBe(200)
    await expect(syncResponse.json()).resolves.toMatchObject({
      domains: {
        equivalentDomains: [
          ['example.com', 'example.net'],
          ['service.test', 'login.service.test'],
        ],
        globalEquivalentDomains: [],
      },
    })
  })

  it('creates and updates equivalent domains through the settings endpoint', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)

    for (const method of ['POST', 'PUT']) {
      const response = await app.request(
        '/api/settings/domains',
        {
          method,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            equivalentDomains: [[' Example.COM ', 'example.net']],
            excludedGlobalEquivalentDomains: [],
          }),
        },
        {
          DB: new FakeD1Database(null, [], {
            authUser: user,
            userUpdateChanges: 1,
          }),
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        },
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        equivalentDomains: [['example.com', 'example.net']],
        globalEquivalentDomains: [],
        EquivalentDomains: [['example.com', 'example.net']],
        GlobalEquivalentDomains: [],
      })
    }
  })

  it('deletes custom equivalent domains by replacing settings with an empty list', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/settings/domains',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          EquivalentDomains: [],
          ExcludedGlobalEquivalentDomains: [],
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          userUpdateChanges: 1,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      equivalentDomains: [],
      globalEquivalentDomains: [],
      EquivalentDomains: [],
      GlobalEquivalentDomains: [],
    })
  })

  it('rejects invalid equivalent-domain settings without updating the user row', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/settings/domains',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'invalid-domain-settings-request',
        },
        body: JSON.stringify({
          equivalentDomains: [['https://example.com', 'example.net']],
          excludedGlobalEquivalentDomains: [],
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          userUpdateChanges: 1,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
      },
      requestId: 'invalid-domain-settings-request',
    })
  })

  it('requires bearer authorization for metadata reads', async () => {
    for (const path of ['/api/policies', '/api/domains']) {
      const response = await app.request(
        path,
        {
          headers: {
            'X-Request-Id': 'metadata-missing-token-request',
          },
        },
        {
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        },
      )

      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: 'missing_token',
        },
        requestId: 'metadata-missing-token-request',
      })
    }
  })

  it('returns the latest account revision date for a valid access token', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/accounts/revision-date',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          folders: [
            {
              id: 'folder-id',
              userId: 'user-id',
              name: '2.encrypted-folder',
              revisionDate: '2026-07-06T00:03:00.000Z',
            },
          ],
          ciphers: [
            {
              id: 'cipher-id',
              userId: 'user-id',
              folderId: null,
              type: 1,
              favorite: 0,
              encryptedJson: '{}',
              revisionDate: '2026-07-06T00:05:00.000Z',
              createdAt: '2026-07-06T00:00:00.000Z',
            },
          ],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toBe('2026-07-06T00:05:00.000Z')
  })

  it('returns account profile metadata for a valid access token', async () => {
    const user = {
      ...authUserRecord(),
      totpEnabled: true,
    }
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/accounts/profile',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          attachments: [
            attachmentRecord(),
            {
              ...pendingAttachmentRecord(),
              id: 'pending-profile-attachment-id',
              size: 50,
            },
            {
              ...attachmentRecord(),
              id: 'other-user-profile-attachment-id',
              userId: 'other-user-id',
              size: 999,
            },
          ],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      object: 'profile',
      id: 'user-id',
      name: 'Person',
      email: 'person@example.test',
      emailVerified: true,
      premium: false,
      premiumFromOrganization: false,
      culture: 'en-US',
      twoFactorEnabled: true,
      key: '2.synthetic-user-key',
      accountKeys: {
        signatureKeyPair: null,
        publicKeyEncryptionKeyPair: {
          publicKey: 'synthetic-public-key',
          wrappedPrivateKey: '2.synthetic-private-key',
          signedPublicKey: null,
        },
        securityState: null,
      },
      avatarColor: '#3366cc',
      creationDate: '2026-07-06T00:00:00.000Z',
      privateKey: '2.synthetic-private-key',
      securityStamp: 'security-stamp',
      forcePasswordReset: false,
      usesKeyConnector: false,
      organizations: [],
      organizationsNew: [],
      providers: [],
      providerOrganizations: [],
      storage: 15,
      maxStorageGb: 1,
      userDecryptionOptions: {
        hasMasterPassword: true,
        masterPasswordUnlock: {
          salt: 'person@example.test',
          kdf: {
            kdfType: 0,
            iterations: 600000,
            memory: null,
            parallelism: null,
          },
          masterKeyWrappedUserKey: '2.synthetic-user-key',
        },
        trustedDeviceOption: null,
        keyConnectorOption: null,
      },
      Id: 'user-id',
      Name: 'Person',
      Email: 'person@example.test',
      EmailVerified: true,
      Premium: false,
      PremiumFromOrganization: false,
      Culture: 'en-US',
      TwoFactorEnabled: true,
      Key: '2.synthetic-user-key',
      AccountKeys: {
        signatureKeyPair: null,
        publicKeyEncryptionKeyPair: {
          publicKey: 'synthetic-public-key',
          wrappedPrivateKey: '2.synthetic-private-key',
          signedPublicKey: null,
        },
        securityState: null,
      },
      AvatarColor: '#3366cc',
      CreationDate: '2026-07-06T00:00:00.000Z',
      PrivateKey: '2.synthetic-private-key',
      SecurityStamp: 'security-stamp',
      ForcePasswordReset: false,
      UsesKeyConnector: false,
      VerifyDevices: false,
      Organizations: [],
      OrganizationsNew: [],
      Providers: [],
      ProviderOrganizations: [],
      Storage: 15,
      MaxStorageGb: 1,
      UserDecryptionOptions: {
        HasMasterPassword: true,
        MasterPasswordUnlock: {
          Salt: 'person@example.test',
          Kdf: {
            KdfType: 0,
            Iterations: 600000,
            Memory: null,
            Parallelism: null,
          },
          MasterKeyEncryptedUserKey: '2.synthetic-user-key',
        },
        TrustedDeviceOption: null,
        KeyConnectorOption: null,
      },
      KeyConnectorUrl: null,
    })
    expect(typeof body.storage).toBe('number')
    expect(typeof body.maxStorageGb).toBe('number')
    expect(typeof body.Storage).toBe('number')
    expect(typeof body.MaxStorageGb).toBe('number')
  })

  it('reports premium across profile shapes without changing other fields or storage', async () => {
    const user = authUserRecord()
    const accessToken = await signAccessToken('test-token-secret', {
      sub: user.id,
      email: user.emailNormalized,
      device: 'fixture-device',
      securityStamp: user.securityStamp,
      iat: 1,
      exp: 4_102_444_800,
      premium: false,
    })

    const responsesForFlag = async (flag: string | undefined) => {
      const env = {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          attachments: [attachmentRecord()],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        ...premiumFeatureBinding(flag),
      }
      const request = {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
      const syncResponse = await app.request('/api/sync', request, env)
      const accountResponse = await app.request(
        '/api/accounts/profile',
        request,
        env,
      )

      expect(syncResponse.status).toBe(200)
      expect(accountResponse.status).toBe(200)

      return {
        sync: (await syncResponse.json()) as Record<string, unknown> & {
          profile: Record<string, unknown>
        },
        account: (await accountResponse.json()) as Record<string, unknown>,
      }
    }

    const absent = await responsesForFlag(undefined)
    const disabled = await responsesForFlag('false')
    const garbage = await responsesForFlag('yes')
    const enabled = await responsesForFlag('true')

    expect(disabled).toEqual(absent)
    expect(garbage).toEqual(absent)
    expect(enabled.sync).toEqual({
      ...absent.sync,
      profile: {
        ...absent.sync.profile,
        premium: true,
      },
    })
    expect(enabled.account).toEqual({
      ...absent.account,
      premium: true,
      Premium: true,
    })
    expect(enabled.sync.profile).toMatchObject({
      premium: true,
      premiumFromOrganization: false,
      storage: 15,
      maxStorageGb: attachmentStoragePolicy.maxStorageGb,
    })
    expect(enabled.account).toMatchObject({
      premium: true,
      Premium: true,
      premiumFromOrganization: false,
      PremiumFromOrganization: false,
      storage: 15,
      Storage: 15,
      maxStorageGb: attachmentStoragePolicy.maxStorageGb,
      MaxStorageGb: attachmentStoragePolicy.maxStorageGb,
    })
    expect(enabled.account.storage).toBe(enabled.account.Storage)
    expect(enabled.account.maxStorageGb).toBe(enabled.account.MaxStorageGb)
    expect(enabled.account.maxStorageGb).toBeGreaterThan(0)
  })

  it('returns a zero-cost canceled billing subscription for mobile startup', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/account/billing/vnext/subscription',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'canceled',
      cart: {
        passwordManager: {
          seats: {
            translationKey: 'premiumMembership',
            quantity: 0,
            cost: 0,
            discount: null,
          },
          additionalStorage: null,
        },
        secretsManager: null,
        cadence: 'annually',
        discount: null,
        estimatedTax: 0,
      },
      storage: null,
      cancelAt: null,
      canceled: null,
      nextCharge: null,
      suspension: null,
      gracePeriod: null,
    })
  })

  it('updates account profile display name for a valid access token', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/accounts/profile',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'profile-update-request',
        },
        body: JSON.stringify({
          Name: 'Renamed Person',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          attachments: [attachmentRecord()],
          userUpdateChanges: 1,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        HONOWARDEN_PREMIUM_FEATURES_ENABLED: 'true',
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('X-Request-Id')).toBe('profile-update-request')
    await expect(response.json()).resolves.toMatchObject({
      object: 'profile',
      Id: 'user-id',
      Name: 'Renamed Person',
      Email: 'person@example.test',
      SecurityStamp: 'security-stamp',
      TwoFactorEnabled: false,
      premium: true,
      premiumFromOrganization: false,
      Premium: true,
      PremiumFromOrganization: false,
      storage: 15,
      maxStorageGb: 1,
      Storage: 15,
      MaxStorageGb: 1,
    })
  })

  it('rejects invalid account profile update payloads', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/accounts/profile',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'invalid-profile-update-request',
        },
        body: JSON.stringify({
          Name: '',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
      },
      requestId: 'invalid-profile-update-request',
    })
  })

  it('returns not found when an account profile update affects no active user', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/accounts/profile',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'missing-profile-update-request',
        },
        body: JSON.stringify({
          name: 'Renamed Person',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          userUpdateChanges: 0,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'account_not_found',
      },
      requestId: 'missing-profile-update-request',
    })
  })

  it('reports enabled TOTP state in sync profile', async () => {
    const user = {
      ...authUserRecord(),
      totpEnabled: true,
    }
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/sync',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      profile: {
        twoFactorEnabled: true,
      },
    })
  })

  it('includes active folders in sync', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/sync',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          folders: [
            {
              id: 'folder-id',
              userId: 'user-id',
              name: '2.encrypted-folder-name',
              revisionDate: '2026-07-06T00:03:00.000Z',
            },
          ],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      folders: [
        {
          object: 'folder',
          id: 'folder-id',
          name: '2.encrypted-folder-name',
          revisionDate: '2026-07-06T00:03:00.000Z',
        },
      ],
    })
  })

  it('rejects sync for disabled users', async () => {
    const user = {
      ...authUserRecord(),
      disabledAt: '2026-07-06T00:00:00.000Z',
    }
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/sync',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_token',
      },
    })
  })

  it('rejects sync when the user security stamp changed after token issue', async () => {
    const tokenUser = authUserRecord()
    const accessToken = await accessTokenFor(tokenUser)
    const response = await app.request(
      '/api/sync',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: {
            ...tokenUser,
            securityStamp: 'rotated-security-stamp',
          },
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_token',
      },
    })
  })

  it('lists active devices for the authenticated user', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/devices',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'device-list-request',
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          devices: [
            {
              id: buildDevicePathId('fixture-device'),
              userId: 'user-id',
              identifier: 'fixture-device',
              name: 'CLI',
              type: 8,
              lastSeenAt: '2026-07-06T00:10:00.000Z',
              createdAt: '2026-07-06T00:00:00.000Z',
              updatedAt: '2026-07-06T00:10:00.000Z',
            },
            {
              id: 'other-user:fixture-device',
              userId: 'other-user',
              identifier: 'fixture-device',
              name: 'Other User Device',
              type: 8,
              lastSeenAt: '2026-07-06T00:30:00.000Z',
              createdAt: '2026-07-06T00:00:00.000Z',
              updatedAt: '2026-07-06T00:30:00.000Z',
            },
            {
              id: buildDevicePathId('revoked-device'),
              userId: 'user-id',
              identifier: 'revoked-device',
              name: 'Revoked',
              type: 8,
              revokedAt: '2026-07-06T00:20:00.000Z',
              lastSeenAt: '2026-07-06T00:15:00.000Z',
              createdAt: '2026-07-06T00:00:00.000Z',
              updatedAt: '2026-07-06T00:20:00.000Z',
            },
          ],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      object: 'list',
      data: [
        {
          object: 'device',
          id: buildDevicePathId('fixture-device'),
          userId: 'user-id',
          name: 'CLI',
          identifier: 'fixture-device',
          type: 8,
          creationDate: '2026-07-06T00:00:00.000Z',
          revisionDate: '2026-07-06T00:10:00.000Z',
          isTrusted: false,
          encryptedUserKey: null,
          encryptedPublicKey: null,
          devicePendingAuthRequest: null,
          lastActivityDate: '2026-07-06T00:10:00.000Z',
        },
      ],
      continuationToken: null,
    })
  })

  it('requires bearer authorization for device list', async () => {
    const response = await app.request(
      '/api/devices',
      {
        headers: {
          'X-Request-Id': 'device-list-missing-token-request',
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: authUserRecord(),
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'missing_token',
      },
      requestId: 'device-list-missing-token-request',
    })
  })

  it('gets a device by identifier for the authenticated user', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/devices/identifier/fixture-device',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          devices: [
            {
              id: buildDevicePathId('fixture-device'),
              userId: 'user-id',
              identifier: 'fixture-device',
              name: 'CLI',
              type: 8,
              lastSeenAt: '2026-07-06T00:10:00.000Z',
              createdAt: '2026-07-06T00:00:00.000Z',
              updatedAt: '2026-07-06T00:10:00.000Z',
            },
            {
              id: 'other-user:fixture-device',
              userId: 'other-user',
              identifier: 'fixture-device',
              name: 'Other User Device',
              type: 8,
              lastSeenAt: '2026-07-06T00:30:00.000Z',
              createdAt: '2026-07-06T00:00:00.000Z',
              updatedAt: '2026-07-06T00:30:00.000Z',
            },
          ],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: 'device',
      id: buildDevicePathId('fixture-device'),
      userId: 'user-id',
      name: 'CLI',
      identifier: 'fixture-device',
      type: 8,
      isTrusted: false,
      encryptedUserKey: null,
      encryptedPublicKey: null,
      devicePendingAuthRequest: null,
    })
  })

  it('returns not found for a missing device identifier', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/devices/identifier/missing-device',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'missing-device-identifier-request',
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          devices: [],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'device_not_found',
      },
      requestId: 'missing-device-identifier-request',
    })
  })

  it('accepts authenticated push-token registration as a no-op for mobile clients', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/devices/identifier/fixture-device/token',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pushToken: 'synthetic-mobile-push-token',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(204)
    await expect(response.text()).resolves.toBe('')
  })

  it('rejects malformed mobile push-token registration payloads', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/devices/identifier/fixture-device/token',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'malformed-push-token-request',
        },
        body: JSON.stringify({
          pushToken: null,
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
      },
      requestId: 'malformed-push-token-request',
    })
  })

  it('updates device metadata for the authenticated user', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const deviceId = buildDevicePathId('fixture-device')
    const response = await app.request(
      `/api/devices/${encodeURIComponent(deviceId)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          Name: 'Renamed CLI',
          Type: 9,
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          deviceUpdateChanges: 1,
          devices: [
            {
              id: deviceId,
              userId: 'user-id',
              identifier: 'fixture-device',
              name: 'CLI',
              type: 8,
              lastSeenAt: '2026-07-06T00:10:00.000Z',
              createdAt: '2026-07-06T00:00:00.000Z',
              updatedAt: '2026-07-06T00:10:00.000Z',
            },
          ],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: 'device',
      id: deviceId,
      userId: 'user-id',
      name: 'Renamed CLI',
      identifier: 'fixture-device',
      type: 9,
      creationDate: '2026-07-06T00:00:00.000Z',
      revisionDate: expect.any(String),
      isTrusted: false,
      encryptedUserKey: null,
      encryptedPublicKey: null,
      devicePendingAuthRequest: null,
      lastActivityDate: '2026-07-06T00:10:00.000Z',
    })
  })

  it('updates encrypted device keys for the authenticated user', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/devices/fixture-device/keys',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'device-keys-update-request',
        },
        body: JSON.stringify({
          EncryptedUserKey: '2.encrypted-user-key',
          EncryptedPublicKey: '2.encrypted-public-key',
          EncryptedPrivateKey: '2.encrypted-private-key',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          deviceUpdateChanges: 1,
          devices: [
            {
              id: buildDevicePathId('fixture-device'),
              userId: 'user-id',
              identifier: 'fixture-device',
              name: 'CLI',
              type: 8,
              encryptedUserKey: null,
              encryptedPublicKey: null,
              encryptedPrivateKey: null,
              lastSeenAt: '2026-07-06T00:10:00.000Z',
              createdAt: '2026-07-06T00:00:00.000Z',
              updatedAt: '2026-07-06T00:10:00.000Z',
            },
          ],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    const body = await response.json<Record<string, unknown>>()
    expect(body).toMatchObject({
      object: 'device',
      id: buildDevicePathId('fixture-device'),
      userId: 'user-id',
      name: 'CLI',
      identifier: 'fixture-device',
      type: 8,
      creationDate: '2026-07-06T00:00:00.000Z',
      revisionDate: expect.any(String),
      isTrusted: true,
      encryptedUserKey: '2.encrypted-user-key',
      encryptedPublicKey: '2.encrypted-public-key',
      devicePendingAuthRequest: null,
      lastActivityDate: '2026-07-06T00:10:00.000Z',
    })
    expect(body).not.toHaveProperty('encryptedPrivateKey')
  })

  it('updates encrypted device keys through the trust alias', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const deviceId = buildDevicePathId('fixture-device')
    const response = await app.request(
      `/api/devices/${encodeURIComponent(deviceId)}/trust`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          encryptedUserKey: '2.alias-encrypted-user-key',
          encryptedPublicKey: '2.alias-encrypted-public-key',
          encryptedPrivateKey: '2.alias-encrypted-private-key',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          deviceUpdateChanges: 1,
          devices: [
            {
              id: deviceId,
              userId: 'user-id',
              identifier: 'fixture-device',
              name: 'CLI',
              type: 8,
              encryptedUserKey: null,
              encryptedPublicKey: null,
              encryptedPrivateKey: null,
              lastSeenAt: '2026-07-06T00:10:00.000Z',
              createdAt: '2026-07-06T00:00:00.000Z',
              updatedAt: '2026-07-06T00:10:00.000Z',
            },
          ],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: 'device',
      id: deviceId,
      isTrusted: true,
      encryptedUserKey: '2.alias-encrypted-user-key',
      encryptedPublicKey: '2.alias-encrypted-public-key',
    })
  })

  it('bulk updates trusted device keys without returning encrypted private keys', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/devices/update-trust',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'bulk-device-trust-request',
        },
        body: JSON.stringify({
          Devices: [
            {
              Id: 'fixture-device',
              EncryptedUserKey: '2.current-encrypted-user-key',
              EncryptedPublicKey: '2.current-encrypted-public-key',
              EncryptedPrivateKey: '2.current-encrypted-private-key',
            },
            {
              Id: buildDevicePathId('other-device'),
              EncryptedUserKey: '2.other-encrypted-user-key',
              EncryptedPublicKey: '2.other-encrypted-public-key',
              EncryptedPrivateKey: '2.other-encrypted-private-key',
            },
          ],
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          deviceUpdateChanges: 1,
          devices: [
            {
              id: buildDevicePathId('fixture-device'),
              userId: 'user-id',
              identifier: 'fixture-device',
              name: 'CLI',
              type: 8,
              encryptedUserKey: null,
              encryptedPublicKey: null,
              encryptedPrivateKey: null,
              lastSeenAt: '2026-07-06T00:10:00.000Z',
              createdAt: '2026-07-06T00:00:00.000Z',
              updatedAt: '2026-07-06T00:10:00.000Z',
            },
            {
              id: buildDevicePathId('other-device'),
              userId: 'user-id',
              identifier: 'other-device',
              name: 'Browser',
              type: 3,
              encryptedUserKey: null,
              encryptedPublicKey: null,
              encryptedPrivateKey: null,
              lastSeenAt: '2026-07-06T00:20:00.000Z',
              createdAt: '2026-07-06T00:01:00.000Z',
              updatedAt: '2026-07-06T00:20:00.000Z',
            },
          ],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    const body = await response.json<Record<string, unknown>>()
    expect(body).toMatchObject({
      object: 'list',
      data: [
        {
          object: 'device',
          id: buildDevicePathId('fixture-device'),
          isTrusted: true,
          encryptedUserKey: '2.current-encrypted-user-key',
          encryptedPublicKey: '2.current-encrypted-public-key',
        },
        {
          object: 'device',
          id: buildDevicePathId('other-device'),
          isTrusted: true,
          encryptedUserKey: '2.other-encrypted-user-key',
          encryptedPublicKey: '2.other-encrypted-public-key',
        },
      ],
      continuationToken: null,
    })
    expect(JSON.stringify(body)).not.toContain('EncryptedPrivateKey')
    expect(JSON.stringify(body)).not.toContain('encryptedPrivateKey')
    expect(JSON.stringify(body)).not.toContain('current-encrypted-private-key')
    expect(JSON.stringify(body)).not.toContain('other-encrypted-private-key')
  })

  it('fails closed when bulk trusted-device payloads are invalid', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/devices/update-trust',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'invalid-bulk-device-trust-request',
        },
        body: JSON.stringify({
          Devices: [
            {
              Id: 'fixture-device',
              EncryptedUserKey: '2.current-encrypted-user-key',
              EncryptedPublicKey: '2.current-encrypted-public-key',
            },
          ],
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
      },
      requestId: 'invalid-bulk-device-trust-request',
    })
  })

  it('rejects invalid encrypted device key payloads', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/devices/fixture-device/keys',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'invalid-device-keys-request',
        },
        body: JSON.stringify({
          EncryptedUserKey: '',
          EncryptedPublicKey: '2.encrypted-public-key',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
      },
      requestId: 'invalid-device-keys-request',
    })
  })

  it('rejects invalid device metadata update payloads', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      `/api/devices/${encodeURIComponent(buildDevicePathId('fixture-device'))}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'invalid-device-update-request',
        },
        body: JSON.stringify({
          Name: '',
          Type: 'desktop',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
      },
      requestId: 'invalid-device-update-request',
    })
  })

  it('returns not found when updating missing, revoked, or cross-user devices', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      `/api/devices/${encodeURIComponent(buildDevicePathId('missing-device'))}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'missing-device-update-request',
        },
        body: JSON.stringify({
          name: 'Renamed CLI',
          type: 9,
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          devices: [],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'device_not_found',
      },
      requestId: 'missing-device-update-request',
    })
  })

  it('revokes another device for the authenticated user', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const targetDeviceId = buildDevicePathId('other-device')
    const response = await app.request(
      `/api/devices/${encodeURIComponent(targetDeviceId)}/revoke`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          deviceRevokeChanges: 1,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: 'deviceRevoke',
      id: targetDeviceId,
      revokedDate: expect.any(String),
    })
  })

  it('emits a secret-safe audit event for device revoke when enabled', async () => {
    const auditLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const targetDeviceId = buildDevicePathId('other-device')
    const response = await app.request(
      `/api/devices/${encodeURIComponent(targetDeviceId)}/revoke`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'audit-device-revoke-request',
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          deviceRevokeChanges: 1,
        }),
        HONOWARDEN_AUDIT_LOGS: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    expect(auditLog).toHaveBeenCalledTimes(1)
    const event = JSON.parse(auditLog.mock.calls[0]?.[0] ?? '{}')
    expect(event).toMatchObject({
      object: 'auditEvent',
      schemaVersion: 1,
      name: 'device.revoke',
      outcome: 'success',
      requestId: 'audit-device-revoke-request',
      actor: {
        userId: 'user-id',
        deviceIdentifier: 'fixture-device',
      },
      target: {
        type: 'device',
        id: targetDeviceId,
      },
    })
    expect(JSON.stringify(event)).not.toContain(accessToken)
    expect(JSON.stringify(event)).not.toContain('test-token-secret')
  })

  it('rejects revoking the current device', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      `/api/devices/${encodeURIComponent(buildDevicePathId('fixture-device'))}/revoke`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'current-device-revoke-request',
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'current_device_revoke_forbidden',
      },
      requestId: 'current-device-revoke-request',
    })
  })

  it('returns not found when revoking a missing, revoked, or cross-user device', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      `/api/devices/${encodeURIComponent(buildDevicePathId('missing-device'))}/revoke`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'missing-device-revoke-request',
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          deviceRevokeChanges: 0,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'device_not_found',
      },
      requestId: 'missing-device-revoke-request',
    })
  })

  it('revokes all other sessions after recent password authentication', async () => {
    const user = authUserRecord()
    const accessToken = await recentPasswordAccessTokenFor(user)
    const response = await app.request(
      '/api/devices/revoke-all',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'revoke-all-sessions-request',
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      object: 'sessionsRevoke',
      currentDeviceId: buildDevicePathId('fixture-device'),
      currentSessionRevoked: false,
      revokedDate: expect.any(String),
      requestId: 'revoke-all-sessions-request',
    })
  })

  it('requires recent password authentication before revoking all other sessions', async () => {
    const user = authUserRecord()
    const accessToken = await refreshAccessTokenFor(user)
    const response = await app.request(
      '/api/devices/revoke-all',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'revoke-all-reauth-request',
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'reauth_required',
      },
      requestId: 'revoke-all-reauth-request',
    })
  })

  it('emits a secret-safe audit event when revoking all other sessions', async () => {
    const auditLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    const user = authUserRecord()
    const accessToken = await recentPasswordAccessTokenFor(user)
    const response = await app.request(
      '/api/devices/revoke-all',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'audit-revoke-all-sessions-request',
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_AUDIT_LOGS: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    expect(auditLog).toHaveBeenCalledTimes(1)
    const event = JSON.parse(auditLog.mock.calls[0]?.[0] ?? '{}')
    expect(event).toMatchObject({
      object: 'auditEvent',
      schemaVersion: 1,
      name: 'session.revoke_all',
      outcome: 'success',
      requestId: 'audit-revoke-all-sessions-request',
      actor: {
        userId: 'user-id',
        deviceIdentifier: 'fixture-device',
      },
      target: {
        type: 'session',
        id: buildDevicePathId('fixture-device'),
      },
      context: {
        currentSessionRevoked: false,
      },
    })
    expect(JSON.stringify(event)).not.toContain(accessToken)
    expect(JSON.stringify(event)).not.toContain('test-token-secret')
  })

  it('verifies the current password hash and returns the pinned empty policy', async () => {
    const user = authUserRecord()
    const database = new FakeD1Database(null, [], { authUser: user })
    const response = await app.request(
      '/api/accounts/verify-password',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await refreshAccessTokenFor(user)}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'verify-password-request',
        },
        body: JSON.stringify({
          masterPasswordHash: user.masterPasswordHash,
        }),
      },
      {
        DB: database,
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      object: 'masterPasswordPolicy',
      minComplexity: null,
      minLength: null,
      requireLower: null,
      requireUpper: null,
      requireNumbers: null,
      requireSpecial: null,
      enforceOnLogin: null,
    })
    expect(database.auditEventInserts).toEqual([])
  })

  it('records invalid password verification proofs without changing credentials', async () => {
    const user = authUserRecord()
    const database = new FakeD1Database(null, [], { authUser: user })
    const prepare = vi.spyOn(database, 'prepare')
    const before = structuredClone(user)
    const response = await app.request(
      '/api/accounts/verify-password',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await accessTokenFor(user)}`,
          'CF-Connecting-IP': '203.0.113.29',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ masterPasswordHash: 'wrong-current-hash' }),
      },
      {
        DB: database,
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
        message: 'The supplied credentials are invalid.',
      },
    })
    expect(user).toMatchObject({
      masterPasswordHash: before.masterPasswordHash,
      userKey: before.userKey,
      securityStamp: before.securityStamp,
      revisionDate: before.revisionDate,
    })
    expect(database.auditEventInserts).toEqual([])
    expect(
      prepare.mock.calls.some(([query]) =>
        query.includes('INSERT INTO auth_attempts'),
      ),
    ).toBe(true)
  })

  it('keeps account-key reads and initialization state-free and default-off', async () => {
    for (const method of ['GET', 'POST'] as const) {
      const user = {
        ...authUserRecord(),
        publicKey: null,
        privateKey: null,
      }
      const database = new FakeD1Database(null, [], { authUser: user })
      const prepare = vi.spyOn(database, 'prepare')
      const before = structuredClone(user)
      const response = await app.request(
        '/api/accounts/keys',
        {
          method,
          headers: {
            Authorization: `Bearer ${await accessTokenFor(user)}`,
            ...(method === 'POST'
              ? { 'Content-Type': 'application/json' }
              : {}),
          },
          ...(method === 'POST'
            ? { body: JSON.stringify(accountKeyInitializationBody()) }
            : {}),
        },
        {
          DB: database,
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        },
      )

      expect(response.status).toBe(501)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: 'unsupported_feature',
          message: 'Account keys are not activated on this server.',
        },
      })
      expect(user).toEqual(before)
      expect(database.auditEventInserts).toEqual([])
      expect(prepare).not.toHaveBeenCalled()
    }
  })

  it('rejects account-key initialization and reads without a wrapped user key', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = {
      ...authUserRecord(),
      userKey: null,
      publicKey: null,
      privateKey: null,
    }
    const database = new FakeD1Database(null, [], { authUser: user })
    const batch = vi.spyOn(database, 'batch')
    const before = structuredClone(user)
    const accessToken = await accessTokenFor(user)
    const env = {
      DB: database,
      HONOWARDEN_ACCOUNT_KEYS_ENABLED: 'true',
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
    }

    const initialize = await app.request(
      '/api/accounts/keys',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(accountKeyInitializationBody()),
      },
      env,
    )

    expect(initialize.status).toBe(409)
    await expect(initialize.json()).resolves.toMatchObject({
      error: { code: 'account_key_state_invalid' },
    })
    expect(user).toEqual(before)
    expect(batch).not.toHaveBeenCalled()
    expect(database.auditEventInserts).toEqual([])

    Object.assign(user, {
      publicKey: 'synthetic-existing-public-key',
      privateKey: '2.synthetic-existing-wrapped-private-key',
    })

    for (const method of ['GET', 'POST'] as const) {
      const response = await app.request(
        '/api/accounts/keys',
        {
          method,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(method === 'POST'
              ? { 'Content-Type': 'application/json' }
              : {}),
          },
          ...(method === 'POST'
            ? {
                body: JSON.stringify({
                  publicKey: user.publicKey,
                  encryptedPrivateKey: user.privateKey,
                }),
              }
            : {}),
        },
        env,
      )

      expect(response.status).toBe(409)
      const body = JSON.stringify(await response.json())
      expect(body).toContain('account_key_state_invalid')
      expect(body).not.toContain(user.publicKey)
      expect(body).not.toContain(user.privateKey)
    }
    expect(batch).not.toHaveBeenCalled()
    expect(database.auditEventInserts).toEqual([])
    expect(JSON.stringify(error.mock.calls)).toContain(
      'wrapped_user_key_missing',
    )
    expect(JSON.stringify(error.mock.calls)).not.toContain(user.publicKey)
    expect(JSON.stringify(error.mock.calls)).not.toContain(user.privateKey)
  })

  it('initializes once, preserves the current session, and projects the pair everywhere', async () => {
    const auditLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    const user = {
      ...authUserRecord(),
      publicKey: null,
      privateKey: null,
    }
    const devices = [
      { id: 'current-device', userId: user.id },
      { id: 'other-device', userId: user.id },
    ]
    const refreshTokens = [
      { id: 'current-refresh', userId: user.id },
      { id: 'other-refresh', userId: user.id },
    ]
    const authRequests = [
      {
        id: 'pending-request',
        userId: user.id,
        status: 'pending',
        requestApproved: null,
        encryptedResponseKey: null,
      },
    ]
    const database = new FakeD1Database(null, [], {
      authUser: user,
      devices,
      refreshTokens,
      authRequests,
    })
    const sessionState = structuredClone({
      devices,
      refreshTokens,
      authRequests,
    })
    const previousRevision = user.revisionDate
    const previousStamp = user.securityStamp
    const accessToken = await accessTokenFor(user)
    const env = {
      DB: database,
      HONOWARDEN_ACCOUNT_KEYS_ENABLED: 'true',
      HONOWARDEN_AUDIT_LOGS: 'true',
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
    }

    const response = await app.request(
      '/api/accounts/keys',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'account-key-initialization-request',
        },
        body: JSON.stringify(accountKeyInitializationBody()),
      },
      env,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual(
      accountKeysEndpointResponse(),
    )
    expect(user).toMatchObject({
      publicKey: 'synthetic-initialized-public-key',
      privateKey: '2.synthetic-initialized-wrapped-private-key',
      securityStamp: previousStamp,
      revisionDate: expect.not.stringMatching(
        new RegExp(`^${previousRevision.replaceAll('.', '\\.')}$`),
      ),
    })
    expect({ devices, refreshTokens, authRequests }).toEqual(sessionState)
    expect(database.auditEventInserts).toEqual([
      expect.objectContaining({
        name: 'account.keys.initialize',
        requestId: 'account-key-initialization-request',
        contextJson: JSON.stringify({
          accountEncryptionVersion: 1,
          securityStampChanged: false,
          sessionsRevoked: false,
        }),
      }),
    ])
    expect(auditLog).toHaveBeenCalledTimes(1)
    const auditJson = JSON.stringify({
      persisted: database.auditEventInserts,
      emitted: auditLog.mock.calls,
    })
    expect(auditJson).not.toContain('synthetic-initialized-public-key')
    expect(auditJson).not.toContain('synthetic-initialized-wrapped-private-key')

    const initializedRevision = user.revisionDate
    const replay = await app.request(
      '/api/accounts/keys',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(accountKeyInitializationBody()),
      },
      env,
    )
    expect(replay.status).toBe(200)
    await expect(replay.json()).resolves.toEqual(accountKeysEndpointResponse())
    expect(user.revisionDate).toBe(initializedRevision)
    expect(database.auditEventInserts).toHaveLength(1)

    const read = await app.request(
      '/api/accounts/keys',
      { headers: { Authorization: `Bearer ${accessToken}` } },
      env,
    )
    expect(read.status).toBe(200)
    await expect(read.json()).resolves.toEqual(accountKeysEndpointResponse())

    const profile = await app.request(
      '/api/accounts/profile',
      { headers: { Authorization: `Bearer ${accessToken}` } },
      env,
    )
    expect(profile.status).toBe(200)
    await expect(profile.json()).resolves.toMatchObject({
      privateKey: '2.synthetic-initialized-wrapped-private-key',
      accountKeys: accountKeysEndpointResponse().accountKeys,
    })

    const sync = await app.request(
      '/api/sync',
      { headers: { Authorization: `Bearer ${accessToken}` } },
      env,
    )
    expect(sync.status).toBe(200)
    await expect(sync.json()).resolves.toMatchObject({
      profile: {
        privateKey: '2.synthetic-initialized-wrapped-private-key',
        accountKeys: accountKeysEndpointResponse().accountKeys,
      },
    })

    const login = await passwordGrantRequest(
      database,
      user.masterPasswordHash,
      'post-initialization-device',
    )
    expect(login.status).toBe(200)
    await expect(login.json()).resolves.toMatchObject({
      PrivateKey: '2.synthetic-initialized-wrapped-private-key',
      AccountKeys: accountKeysEndpointResponse().accountKeys,
    })
  })

  it('resolves a concurrent exact account-key retry without a second audit', async () => {
    const user = {
      ...authUserRecord(),
      publicKey: null,
      privateKey: null,
    }
    const database = new FakeD1Database(null, [], { authUser: user })
    const accessToken = await accessTokenFor(user)
    const request = () =>
      app.request(
        '/api/accounts/keys',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(accountKeyInitializationBody()),
        },
        {
          DB: database,
          HONOWARDEN_ACCOUNT_KEYS_ENABLED: 'true',
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        },
      )

    const responses = await Promise.all([request(), request()])

    expect(responses.map((response) => response.status)).toEqual([200, 200])
    await expect(responses[0]?.json()).resolves.toEqual(
      accountKeysEndpointResponse(),
    )
    await expect(responses[1]?.json()).resolves.toEqual(
      accountKeysEndpointResponse(),
    )
    expect(database.auditEventInserts).toHaveLength(1)
  })

  it('rejects a concurrent exact keypair when the authenticated stamp changed', async () => {
    const user = {
      ...authUserRecord(),
      publicKey: null,
      privateKey: null,
    }
    const database = new FakeD1Database(null, [], { authUser: user })
    const originalBatch = database.batch.bind(database)
    vi.spyOn(database, 'batch').mockImplementationOnce(async (statements) => {
      Object.assign(user, {
        publicKey: 'synthetic-initialized-public-key',
        privateKey: '2.synthetic-initialized-wrapped-private-key',
        securityStamp: 'concurrently-rotated-security-stamp',
        revisionDate: '2026-07-19T00:00:02.000Z',
      })
      return originalBatch(statements)
    })

    const response = await app.request(
      '/api/accounts/keys',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await accessTokenFor(user)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(accountKeyInitializationBody()),
      },
      {
        DB: database,
        HONOWARDEN_ACCOUNT_KEYS_ENABLED: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(409)
    const body = JSON.stringify(await response.json())
    expect(body).toContain('account_key_conflict')
    expect(body).not.toContain('synthetic-initialized-public-key')
    expect(body).not.toContain('synthetic-initialized-wrapped-private-key')
    expect(database.auditEventInserts).toEqual([])
  })

  it('rejects partial account keys before creating a TOTP challenge or session', async () => {
    const encryptedSecret = await encryptTotpSecret(
      'test-totp-secret',
      'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    )
    const user = {
      ...authUserRecord(),
      publicKey: 'synthetic-surviving-public-key',
      privateKey: null,
      totpEnabled: true,
      totpEncryptedSecret: encryptedSecret,
    }
    const database = new FakeD1Database(null, [], { authUser: user })
    const prepare = vi.spyOn(database, 'prepare')

    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Device-Identifier': 'fixture-device',
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: user.emailNormalized,
          password: user.masterPasswordHash,
        }),
      },
      {
        DB: database,
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        HONOWARDEN_TOTP_SECRET: 'test-totp-secret',
      },
    )

    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body).toEqual({
      error: {
        code: 'database_unavailable',
        message: 'Token exchange failed.',
      },
      requestId: expect.any(String),
    })
    expect(JSON.stringify(body)).not.toContain('synthetic-surviving-public-key')
    const queries = prepare.mock.calls.map(([query]) => String(query))
    expect(
      queries.some((query) => query.includes('INSERT INTO totp_challenges')),
    ).toBe(false)
    expect(
      queries.some((query) => query.includes('INSERT INTO refresh_tokens')),
    ).toBe(false)
  })

  it('rejects partial, unknown, and V2 request variants before key mutation', async () => {
    for (const body of [
      { publicKey: 'synthetic-initialized-public-key' },
      {
        ...accountKeyInitializationBody(),
        unexpected: 'unsupported',
      },
      {
        ...accountKeyInitializationBody(),
        accountKeys: null,
      },
    ]) {
      const user = {
        ...authUserRecord(),
        publicKey: null,
        privateKey: null,
      }
      const before = structuredClone(user)
      const database = new FakeD1Database(null, [], { authUser: user })
      const response = await app.request(
        '/api/accounts/keys',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await accessTokenFor(user)}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
        {
          DB: database,
          HONOWARDEN_ACCOUNT_KEYS_ENABLED: 'true',
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        },
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'invalid_request' },
      })
      expect(user).toEqual(before)
      expect(database.auditEventInserts).toEqual([])
    }
  })

  it('does not disclose or replace missing, partial, or different account-key state', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const missingUser = {
      ...authUserRecord(),
      publicKey: null,
      privateKey: null,
    }
    const missingRead = await app.request(
      '/api/accounts/keys',
      {
        headers: {
          Authorization: `Bearer ${await accessTokenFor(missingUser)}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], { authUser: missingUser }),
        HONOWARDEN_ACCOUNT_KEYS_ENABLED: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )
    expect(missingRead.status).toBe(409)
    await expect(missingRead.json()).resolves.toMatchObject({
      error: { code: 'account_keys_uninitialized' },
    })

    const existingUser = authUserRecord()
    const existingBefore = structuredClone(existingUser)
    const existingDatabase = new FakeD1Database(null, [], {
      authUser: existingUser,
    })
    const differentWrite = await app.request(
      '/api/accounts/keys',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await accessTokenFor(existingUser)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(accountKeyInitializationBody()),
      },
      {
        DB: existingDatabase,
        HONOWARDEN_ACCOUNT_KEYS_ENABLED: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )
    expect(differentWrite.status).toBe(409)
    const differentBody = JSON.stringify(await differentWrite.json())
    expect(differentBody).toContain('account_key_conflict')
    expect(differentBody).not.toContain(existingUser.publicKey ?? '')
    expect(differentBody).not.toContain(existingUser.privateKey ?? '')
    expect(existingUser).toEqual(existingBefore)
    expect(existingDatabase.auditEventInserts).toEqual([])

    for (const partial of [
      {
        publicKey: 'surviving-public-key',
        privateKey: null,
      },
      {
        publicKey: null,
        privateKey: '2.surviving-wrapped-private-key',
      },
    ]) {
      const user = { ...authUserRecord(), ...partial }
      const database = new FakeD1Database(null, [], { authUser: user })
      const accessToken = await accessTokenFor(user)
      const read = await app.request(
        '/api/accounts/keys',
        { headers: { Authorization: `Bearer ${accessToken}` } },
        {
          DB: database,
          HONOWARDEN_ACCOUNT_KEYS_ENABLED: 'true',
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        },
      )
      expect(read.status).toBe(409)
      const readBody = JSON.stringify(await read.json())
      expect(readBody).toContain('account_key_state_invalid')
      for (const storedValue of [partial.publicKey, partial.privateKey]) {
        if (storedValue) {
          expect(readBody).not.toContain(storedValue)
        }
      }

      for (const path of ['/api/accounts/profile', '/api/sync']) {
        const projection = await app.request(
          path,
          { headers: { Authorization: `Bearer ${accessToken}` } },
          {
            DB: database,
            HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
          },
        )
        expect(projection.status).toBe(503)
        const projectionBody = JSON.stringify(await projection.json())
        for (const storedValue of [partial.publicKey, partial.privateKey]) {
          if (storedValue) {
            expect(projectionBody).not.toContain(storedValue)
          }
        }
      }
    }
    expect(JSON.stringify(error.mock.calls)).not.toContain(
      'surviving-wrapped-private-key',
    )
    expect(JSON.stringify(error.mock.calls)).not.toContain(
      'surviving-public-key',
    )
  })

  it('rolls the account-key row back when required audit persistence fails', async () => {
    const user = {
      ...authUserRecord(),
      publicKey: null,
      privateKey: null,
    }
    const before = structuredClone(user)
    const database = new FakeD1Database(null, [], {
      authUser: user,
      accountKeyInitializationFailureAt: 'audit',
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await app.request(
      '/api/accounts/keys',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await accessTokenFor(user)}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'account-key-audit-failure-request',
        },
        body: JSON.stringify(accountKeyInitializationBody()),
      },
      {
        DB: database,
        HONOWARDEN_ACCOUNT_KEYS_ENABLED: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'database_unavailable' },
      requestId: 'account-key-audit-failure-request',
    })
    expect(user).toEqual(before)
    expect(database.auditEventInserts).toEqual([])
    expect(error).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'account_key_initialization_failed',
        requestId: 'account-key-audit-failure-request',
        reason: 'database_error',
      }),
    )
    expect(JSON.stringify(error.mock.calls)).not.toContain(
      'synthetic-initialized-wrapped-private-key',
    )
  })

  it('changes PBKDF2 to Argon2id and projects the new generation everywhere', async () => {
    const auditLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    const user = authUserRecord()
    const previousCipher = cipherRecord()
    const devices = [
      {
        id: buildDevicePathId('fixture-device'),
        userId: user.id,
        identifier: 'fixture-device',
      },
      {
        id: buildDevicePathId('other-device'),
        userId: user.id,
        identifier: 'other-device',
      },
    ]
    const refreshTokens = [
      { id: 'current-token', userId: user.id },
      { id: 'other-token', userId: user.id },
    ]
    const database = new FakeD1Database(null, [], {
      authUser: user,
      ciphers: [previousCipher],
      devices,
      refreshTokens,
    })
    const oldAccessToken = await refreshAccessTokenFor(user)
    const response = await app.request(
      '/api/accounts/kdf',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${oldAccessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'kdf-change-request',
        },
        body: JSON.stringify(kdfChangeBody(user)),
      },
      {
        DB: database,
        HONOWARDEN_AUDIT_LOGS: 'true',
        HONOWARDEN_KDF_MUTATION_ENABLED: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.text()).resolves.toBe('')
    expect(user).toMatchObject({
      kdfAlgorithm: 'argon2id',
      kdfIterations: 6,
      kdfMemory: 32,
      kdfParallelism: 4,
      masterPasswordHash: 'synthetic-argon2-master-password-hash',
      userKey: '2.synthetic-argon2-user-key',
      securityStamp: expect.not.stringMatching(/^security-stamp$/),
      revisionDate: expect.not.stringMatching(/^2026-07-06T00:00:00\.000Z$/),
    })
    expect(devices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ revokedAt: expect.any(String) }),
        expect.objectContaining({ revokedAt: expect.any(String) }),
      ]),
    )
    expect(refreshTokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ revokedAt: expect.any(String) }),
        expect.objectContaining({ revokedAt: expect.any(String) }),
      ]),
    )
    expect(previousCipher).toEqual(cipherRecord())
    expect(database.auditEventInserts).toEqual([
      expect.objectContaining({
        name: 'account.kdf.change',
        outcome: 'success',
        requestId: 'kdf-change-request',
        contextJson: JSON.stringify({
          d1SessionsRevoked: true,
          previousKdfType: 0,
          nextKdfType: 1,
        }),
      }),
    ])
    expect(JSON.stringify(database.auditEventInserts)).not.toContain(
      'synthetic-argon2-master-password-hash',
    )
    expect(JSON.stringify(auditLog.mock.calls)).not.toContain(
      '2.synthetic-argon2-user-key',
    )

    const preloginResponse = await app.request(
      '/identity/accounts/prelogin',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.emailNormalized }),
      },
      {
        DB: database,
        HONOWARDEN_ALLOWED_EMAILS: user.emailNormalized,
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )
    expect(preloginResponse.status).toBe(200)
    await expect(preloginResponse.json()).resolves.toMatchObject({
      kdf: 1,
      kdfIterations: 6,
      kdfMemory: 32,
      kdfParallelism: 4,
      kdfSettings: { kdfType: 1, iterations: 6, memory: 32, parallelism: 4 },
      salt: user.emailNormalized,
    })

    const oldTokenResponse = await app.request(
      '/api/sync',
      { headers: { Authorization: `Bearer ${oldAccessToken}` } },
      { DB: database, HONOWARDEN_TOKEN_SECRET: 'test-token-secret' },
    )
    expect(oldTokenResponse.status).toBe(401)

    const oldKdfResponse = await passwordGrantRequest(
      database,
      'synthetic-master-password-hash',
      'old-kdf-device',
    )
    expect(oldKdfResponse.status).toBe(400)

    const newKdfResponse = await passwordGrantRequest(
      database,
      'synthetic-argon2-master-password-hash',
      'new-kdf-device',
    )
    expect(newKdfResponse.status).toBe(200)
    const newToken = (await newKdfResponse.json()) as {
      access_token: string
      Key: string
      Kdf: number
      KdfIterations: number
      KdfMemory: number
      KdfParallelism: number
      UserDecryptionOptions: {
        MasterPasswordUnlock: { Kdf: { KdfType: number } }
      }
    }
    expect(newToken).toMatchObject({
      Key: '2.synthetic-argon2-user-key',
      Kdf: 1,
      KdfIterations: 6,
      KdfMemory: 32,
      KdfParallelism: 4,
      UserDecryptionOptions: {
        MasterPasswordUnlock: { Kdf: { KdfType: 1 } },
      },
    })

    const profileResponse = await app.request(
      '/api/accounts/profile',
      { headers: { Authorization: `Bearer ${newToken.access_token}` } },
      { DB: database, HONOWARDEN_TOKEN_SECRET: 'test-token-secret' },
    )
    expect(profileResponse.status).toBe(200)
    await expect(profileResponse.json()).resolves.toMatchObject({
      userDecryptionOptions: {
        masterPasswordUnlock: {
          kdf: { kdfType: 1, iterations: 6, memory: 32, parallelism: 4 },
        },
      },
    })

    const syncResponse = await app.request(
      '/api/sync',
      { headers: { Authorization: `Bearer ${newToken.access_token}` } },
      { DB: database, HONOWARDEN_TOKEN_SECRET: 'test-token-secret' },
    )
    expect(syncResponse.status).toBe(200)
    await expect(syncResponse.json()).resolves.toMatchObject({
      profile: { key: '2.synthetic-argon2-user-key' },
      userDecryption: {
        masterPasswordUnlock: {
          kdf: { kdfType: 1, iterations: 6, memory: 32, parallelism: 4 },
        },
      },
      ciphers: [expect.objectContaining({ id: previousCipher.id })],
    })
  })

  it('keeps KDF mutation state-free and default-off for rollback safety', async () => {
    const user = authUserRecord()
    const database = new FakeD1Database(null, [], { authUser: user })
    const prepare = vi.spyOn(database, 'prepare')
    const before = structuredClone(user)
    const response = await app.request(
      '/api/accounts/kdf',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await accessTokenFor(user)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(kdfChangeBody(user)),
      },
      {
        DB: database,
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(501)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({
      Message: 'KDF mutation is not activated on this server.',
      error: {
        code: 'unsupported_feature',
        message: 'KDF mutation is not activated on this server.',
      },
    })
    expect(user).toEqual(before)
    expect(database.auditEventInserts).toEqual([])
    expect(prepare).not.toHaveBeenCalled()
  })

  it('keeps the complete KDF generation state-free on proof and D1 failure', async () => {
    for (const failure of ['proof', 'audit'] as const) {
      const user = authUserRecord()
      const devices = [{ id: 'device-id', userId: user.id }]
      const refreshTokens = [{ id: 'token-id', userId: user.id }]
      const database = new FakeD1Database(null, [], {
        authUser: user,
        devices,
        refreshTokens,
        ...(failure === 'audit'
          ? { credentialRotationFailureAt: 'audit' as const }
          : {}),
      })
      const before = structuredClone({ user, devices, refreshTokens })
      const body = kdfChangeBody(user)
      const response = await app.request(
        '/api/accounts/kdf',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await accessTokenFor(user)}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...body,
            masterPasswordHash:
              failure === 'proof'
                ? 'wrong-current-hash'
                : body.masterPasswordHash,
          }),
        },
        {
          DB: database,
          HONOWARDEN_KDF_MUTATION_ENABLED: 'true',
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        },
      )

      expect(response.status).toBe(failure === 'proof' ? 400 : 503)
      expect({ user, devices, refreshTokens }).toEqual(before)
      expect(database.auditEventInserts).toEqual([])
    }
  })

  it('changes Argon2id back to PBKDF2 as one guarded generation', async () => {
    const user = {
      ...authUserRecord(),
      kdfAlgorithm: 'argon2id',
      kdfIterations: 6,
      kdfMemory: 32,
      kdfParallelism: 4,
      masterPasswordHash: 'synthetic-argon2-master-password-hash',
      userKey: '2.synthetic-argon2-user-key',
    }
    const database = new FakeD1Database(null, [], { authUser: user })
    const response = await app.request(
      '/api/accounts/kdf',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await accessTokenFor(user)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          kdfChangeBody(user, {
            kdf: {
              kdfType: 0,
              iterations: 600000,
              memory: null,
              parallelism: null,
            },
            nextMasterPasswordHash: 'synthetic-pbkdf2-master-password-hash',
            nextUserKey: '2.synthetic-pbkdf2-user-key',
          }),
        ),
      },
      {
        DB: database,
        HONOWARDEN_KDF_MUTATION_ENABLED: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    expect(user).toMatchObject({
      kdfAlgorithm: 'pbkdf2-sha256',
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
      masterPasswordHash: 'synthetic-pbkdf2-master-password-hash',
      userKey: '2.synthetic-pbkdf2-user-key',
    })
  })

  it('returns conflict without partial KDF or session changes', async () => {
    const user = authUserRecord()
    const devices = [{ id: 'device-id', userId: user.id }]
    const refreshTokens = [{ id: 'token-id', userId: user.id }]
    const database = new FakeD1Database(null, [], {
      authUser: user,
      devices,
      refreshTokens,
      credentialRotationConflict: true,
    })
    const before = structuredClone({ user, devices, refreshTokens })
    const response = await app.request(
      '/api/accounts/kdf',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await accessTokenFor(user)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(kdfChangeBody(user)),
      },
      {
        DB: database,
        HONOWARDEN_KDF_MUTATION_ENABLED: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'revision_conflict' },
    })
    expect({ user, devices, refreshTokens }).toEqual(before)
    expect(database.auditEventInserts).toEqual([])
  })

  it('rejects KDF change before mutation when notification binding is missing', async () => {
    const user = authUserRecord()
    const database = new FakeD1Database(null, [], { authUser: user })
    const before = structuredClone(user)
    const response = await app.request(
      '/api/accounts/kdf',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await accessTokenFor(user)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(kdfChangeBody(user)),
      },
      {
        DB: database,
        HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED: 'true',
        HONOWARDEN_KDF_MUTATION_ENABLED: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'server_misconfigured' },
    })
    expect(user).toEqual(before)
    expect(database.auditEventInserts).toEqual([])
  })

  it('acknowledges a committed KDF generation when notification cleanup fails', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const waitUntil = vi.fn()
    const user = authUserRecord()
    const database = new FakeD1Database(null, [], { authUser: user })
    const response = await app.request(
      '/api/accounts/kdf',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await accessTokenFor(user)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(kdfChangeBody(user)),
      },
      {
        DB: database,
        NOTIFICATION_HUB: {
          idFromName: () => 'user-object',
          get: () => ({
            fetch: vi.fn().mockRejectedValue(new Error('do unavailable')),
          }),
        } as unknown as DurableObjectNamespace,
        HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED: 'true',
        HONOWARDEN_KDF_MUTATION_ENABLED: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
      { waitUntil } as unknown as ExecutionContext,
    )

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('')
    expect(user).toMatchObject({
      kdfAlgorithm: 'argon2id',
      kdfIterations: 6,
      kdfMemory: 32,
      kdfParallelism: 4,
      masterPasswordHash: 'synthetic-argon2-master-password-hash',
      userKey: '2.synthetic-argon2-user-key',
    })
    expect(database.auditEventInserts).toEqual([
      expect.objectContaining({ name: 'account.kdf.change' }),
    ])
    expect(waitUntil).toHaveBeenCalledOnce()
    const cleanup = waitUntil.mock.calls[0]?.[0] as Promise<void>
    await expect(cleanup).resolves.toBeUndefined()
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining(
        'account_notification_session_invalidation_failed',
      ),
    )
  })

  it('does not wait for stalled notification cleanup after committing a KDF generation', async () => {
    let releaseCleanup!: (response: Response) => void
    const cleanup = new Promise<Response>((resolve) => {
      releaseCleanup = resolve
    })
    const fetch = vi.fn(() => cleanup)
    const waitUntil = vi.fn()
    const user = authUserRecord()
    const database = new FakeD1Database(null, [], { authUser: user })
    let responseSettled = false
    const responsePromise = Promise.resolve(
      app.request(
        '/api/accounts/kdf',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await accessTokenFor(user)}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(kdfChangeBody(user)),
        },
        {
          DB: database,
          NOTIFICATION_HUB: {
            idFromName: () => 'user-object',
            get: () => ({ fetch }),
          } as unknown as DurableObjectNamespace,
          HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED: 'true',
          HONOWARDEN_KDF_MUTATION_ENABLED: 'true',
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        },
        { waitUntil } as unknown as ExecutionContext,
      ),
    ).then((response) => {
      responseSettled = true
      return response
    })

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    await new Promise((resolve) => setTimeout(resolve, 0))
    const settledBeforeCleanup = responseSettled
    releaseCleanup(new Response(null, { status: 200 }))
    const response = await responsePromise

    expect(settledBeforeCleanup).toBe(true)
    expect(response.status).toBe(200)
    expect(waitUntil).toHaveBeenCalledOnce()
  })

  it('aborts and logs stalled notification cleanup before the platform deadline', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    vi.useFakeTimers()
    let outboundRequest: Request | undefined
    const fetch = vi.fn((request: Request) => {
      outboundRequest = request
      return new Promise<Response>(() => undefined)
    })
    const waitUntil = vi.fn()
    const database = new FakeD1Database(null, [], { authUser: user })

    const response = await app.request(
      '/api/accounts/kdf',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'stalled-notification-cleanup',
        },
        body: JSON.stringify(kdfChangeBody(user)),
      },
      {
        DB: database,
        NOTIFICATION_HUB: {
          idFromName: () => 'user-object',
          get: () => ({ fetch }),
        } as unknown as DurableObjectNamespace,
        HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED: 'true',
        HONOWARDEN_KDF_MUTATION_ENABLED: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
      { waitUntil } as unknown as ExecutionContext,
    )

    expect(response.status).toBe(200)
    expect(fetch).toHaveBeenCalledOnce()
    expect(waitUntil).toHaveBeenCalledOnce()
    expect(outboundRequest?.signal.aborted).toBe(false)
    let cleanupSettled = false
    const cleanup = waitUntil.mock.calls[0]?.[0] as Promise<void>
    void cleanup.then(() => {
      cleanupSettled = true
    })

    await vi.advanceTimersByTimeAsync(10_000)

    expect(cleanupSettled).toBe(true)
    expect(outboundRequest?.signal.aborted).toBe(true)
    expect(errorLog).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'account_notification_session_invalidation_failed',
        requestId: 'stalled-notification-cleanup',
        reason: 'notification_hub_unavailable',
      }),
    )
  })

  it('changes the master-password generation and preserves encrypted vault data', async () => {
    const auditLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    const user = authUserRecord()
    const previousKdf = {
      emailNormalized: user.emailNormalized,
      kdfAlgorithm: user.kdfAlgorithm,
      kdfIterations: user.kdfIterations,
      kdfMemory: user.kdfMemory,
      kdfParallelism: user.kdfParallelism,
    }
    const previousCipher = cipherRecord()
    const devices = [
      {
        id: buildDevicePathId('fixture-device'),
        userId: user.id,
        identifier: 'fixture-device',
      },
      {
        id: buildDevicePathId('other-device'),
        userId: user.id,
        identifier: 'other-device',
      },
    ]
    const refreshTokens = [
      { id: 'current-token', userId: user.id },
      { id: 'other-token', userId: user.id },
    ]
    const database = new FakeD1Database(null, [], {
      authUser: user,
      ciphers: [previousCipher],
      devices,
      refreshTokens,
    })
    const oldAccessToken = await refreshAccessTokenFor(user)
    const response = await app.request(
      '/api/accounts/password',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${oldAccessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'password-change-request',
        },
        body: JSON.stringify(masterPasswordChangeBody(user)),
      },
      {
        DB: database,
        HONOWARDEN_AUDIT_LOGS: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.text()).resolves.toBe('')
    expect(user).toMatchObject({
      ...previousKdf,
      masterPasswordHash: 'synthetic-next-master-password-hash',
      userKey: '2.synthetic-next-user-key',
      securityStamp: expect.not.stringMatching(/^security-stamp$/),
      revisionDate: expect.not.stringMatching(/^2026-07-06T00:00:00\.000Z$/),
    })
    expect(devices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ revokedAt: expect.any(String) }),
        expect.objectContaining({ revokedAt: expect.any(String) }),
      ]),
    )
    expect(refreshTokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ revokedAt: expect.any(String) }),
        expect.objectContaining({ revokedAt: expect.any(String) }),
      ]),
    )
    expect(previousCipher).toEqual(cipherRecord())
    expect(database.auditEventInserts).toEqual([
      expect.objectContaining({
        name: 'account.password.change',
        outcome: 'success',
        requestId: 'password-change-request',
        contextJson: JSON.stringify({
          d1SessionsRevoked: true,
          kdfUnchanged: true,
        }),
      }),
    ])
    expect(auditLog).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(database.auditEventInserts)).not.toContain(
      'synthetic-next-master-password-hash',
    )
    expect(JSON.stringify(auditLog.mock.calls)).not.toContain(
      '2.synthetic-next-user-key',
    )

    const oldTokenResponse = await app.request(
      '/api/sync',
      { headers: { Authorization: `Bearer ${oldAccessToken}` } },
      {
        DB: database,
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )
    expect(oldTokenResponse.status).toBe(401)

    const oldPasswordResponse = await passwordGrantRequest(
      database,
      'synthetic-master-password-hash',
      'old-password-device',
    )
    expect(oldPasswordResponse.status).toBe(400)

    const newPasswordResponse = await passwordGrantRequest(
      database,
      'synthetic-next-master-password-hash',
      'new-password-device',
    )
    expect(newPasswordResponse.status).toBe(200)
    const newToken = (await newPasswordResponse.json()) as {
      access_token: string
      Key: string
      Kdf: number
      KdfIterations: number
    }
    expect(newToken).toMatchObject({
      Key: '2.synthetic-next-user-key',
      Kdf: 0,
      KdfIterations: 600000,
    })
    const newSyncResponse = await app.request(
      '/api/sync',
      { headers: { Authorization: `Bearer ${newToken.access_token}` } },
      {
        DB: database,
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )
    expect(newSyncResponse.status).toBe(200)
    const newSync = (await newSyncResponse.json()) as {
      profile: { key: string }
      ciphers: unknown[]
    }
    expect(newSync.profile.key).toBe('2.synthetic-next-user-key')
    expect(newSync.ciphers).toEqual([
      expect.objectContaining({
        id: previousCipher.id,
        name: '2.encrypted-cipher-name',
      }),
    ])
  })

  it('rejects password hints and structured credential drift before mutation', async () => {
    for (const bodyForUser of [
      (user: ReturnType<typeof authUserRecord>) => ({
        ...masterPasswordChangeBody(user),
        masterPasswordHint: 'unsupported hint',
      }),
      (user: ReturnType<typeof authUserRecord>) => {
        const body = masterPasswordChangeBody(user)
        return {
          ...body,
          authenticationData: {
            ...body.authenticationData,
            salt: 'different@example.test',
          },
          unlockData: {
            ...body.unlockData,
            salt: 'different@example.test',
          },
        }
      },
      (user: ReturnType<typeof authUserRecord>) => {
        const body = masterPasswordChangeBody(user)
        const kdf = { ...body.authenticationData.kdf, iterations: 600001 }
        return {
          ...body,
          authenticationData: { ...body.authenticationData, kdf },
          unlockData: { ...body.unlockData, kdf },
        }
      },
    ]) {
      const user = authUserRecord()
      const database = new FakeD1Database(null, [], { authUser: user })
      const before = structuredClone(user)
      const response = await app.request(
        '/api/accounts/password',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${await accessTokenFor(user)}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(bodyForUser(user)),
        },
        {
          DB: database,
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        },
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'invalid_request' },
      })
      expect(user).toEqual(before)
      expect(database.auditEventInserts).toEqual([])
    }
  })

  it('rejects a wrong current hash before password-change mutation', async () => {
    const user = authUserRecord()
    const database = new FakeD1Database(null, [], { authUser: user })
    const before = structuredClone(user)
    const response = await app.request(
      '/api/accounts/password',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await accessTokenFor(user)}`,
          'CF-Connecting-IP': '203.0.113.30',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...masterPasswordChangeBody(user),
          masterPasswordHash: 'wrong-current-hash',
        }),
      },
      {
        DB: database,
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    expect(user).toMatchObject({
      masterPasswordHash: before.masterPasswordHash,
      userKey: before.userKey,
      securityStamp: before.securityStamp,
      revisionDate: before.revisionDate,
    })
    expect(database.auditEventInserts).toEqual([])
  })

  it('returns a conflict without partial password or session changes', async () => {
    const user = authUserRecord()
    const devices = [{ id: 'device-id', userId: user.id }]
    const refreshTokens = [{ id: 'token-id', userId: user.id }]
    const database = new FakeD1Database(null, [], {
      authUser: user,
      devices,
      refreshTokens,
      credentialRotationConflict: true,
    })
    const before = structuredClone({ user, devices, refreshTokens })
    const response = await app.request(
      '/api/accounts/password',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await accessTokenFor(user)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(masterPasswordChangeBody(user)),
      },
      {
        DB: database,
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'revision_conflict' },
    })
    expect({ user, devices, refreshTokens }).toEqual(before)
    expect(database.auditEventInserts).toEqual([])
  })

  it('rolls password and sessions back when mandatory audit persistence fails', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = authUserRecord()
    const devices = [{ id: 'device-id', userId: user.id }]
    const refreshTokens = [{ id: 'token-id', userId: user.id }]
    const database = new FakeD1Database(null, [], {
      authUser: user,
      devices,
      refreshTokens,
      credentialRotationFailureAt: 'audit',
    })
    const before = structuredClone({ user, devices, refreshTokens })
    const response = await app.request(
      '/api/accounts/password',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await accessTokenFor(user)}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'password-change-audit-failure-request',
        },
        body: JSON.stringify(masterPasswordChangeBody(user)),
      },
      {
        DB: database,
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'database_unavailable' },
      requestId: 'password-change-audit-failure-request',
    })
    expect({ user, devices, refreshTokens }).toEqual(before)
    expect(database.auditEventInserts).toEqual([])
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('account_password_change_failed'),
    )
  })

  it('rejects password change before mutation when notification binding is missing', async () => {
    const user = authUserRecord()
    const database = new FakeD1Database(null, [], { authUser: user })
    const before = structuredClone(user)
    const response = await app.request(
      '/api/accounts/password',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await accessTokenFor(user)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(masterPasswordChangeBody(user)),
      },
      {
        DB: database,
        HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'server_misconfigured' },
    })
    expect(user).toEqual(before)
    expect(database.auditEventInserts).toEqual([])
  })

  it('reports incomplete notification cleanup after committing password change', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = authUserRecord()
    const database = new FakeD1Database(null, [], { authUser: user })
    const response = await app.request(
      '/api/accounts/password',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await accessTokenFor(user)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(masterPasswordChangeBody(user)),
      },
      {
        DB: database,
        NOTIFICATION_HUB: {
          idFromName: () => 'user-object',
          get: () => ({
            fetch: vi.fn().mockRejectedValue(new Error('do unavailable')),
          }),
        } as unknown as DurableObjectNamespace,
        HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'session_revocation_incomplete',
        message:
          'Account password changed, but notification session cleanup is incomplete.',
      },
    })
    expect(user).toMatchObject({
      masterPasswordHash: 'synthetic-next-master-password-hash',
      userKey: '2.synthetic-next-user-key',
    })
    expect(database.auditEventInserts).toEqual([
      expect.objectContaining({
        contextJson: JSON.stringify({
          d1SessionsRevoked: true,
          kdfUnchanged: true,
        }),
      }),
    ])
    expect(database.auditEventInserts[0]?.contextJson).not.toContain(
      'allSessionsRevoked',
    )
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining(
        'account_notification_session_invalidation_failed',
      ),
    )
  })

  it('supports the pinned legacy payload with nullable structured alternatives', async () => {
    const user = authUserRecord()
    const database = new FakeD1Database(null, [], { authUser: user })
    const response = await app.request(
      '/api/accounts/password',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await accessTokenFor(user)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          masterPasswordHash: user.masterPasswordHash,
          newMasterPasswordHash: 'synthetic-legacy-next-hash',
          key: '2.synthetic-legacy-next-user-key',
          authenticationData: null,
          unlockData: null,
          masterPasswordHint: '',
        }),
      },
      {
        DB: database,
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    expect(user).toMatchObject({
      masterPasswordHash: 'synthetic-legacy-next-hash',
      userKey: '2.synthetic-legacy-next-user-key',
      kdfAlgorithm: 'pbkdf2-sha256',
      kdfIterations: 600000,
    })
  })

  it('rotates the security stamp and invalidates every existing session atomically', async () => {
    const auditLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    const user = authUserRecord()
    const accessToken = await recentPasswordAccessTokenFor(user)
    const authRequestSecret = '0123456789abcdef0123456789abcdef'
    const authRequestAccessCode = 'high-entropy-access-code'
    const approvedAuthRequest = {
      ...authRequestRecord(),
      status: 'approved',
      requestApproved: 1,
      approvingDeviceIdentifier: 'fixture-device',
      encryptedResponseKey: 'opaque-encrypted-key',
      responseAt: '2026-07-11T00:05:00.000Z',
      accessCodeHash: await buildAuthRequestAccessCodeHash(
        authRequestSecret,
        'auth-request-id',
        authRequestAccessCode,
      ),
    }
    const devices = [
      {
        id: buildDevicePathId('fixture-device'),
        userId: user.id,
        identifier: 'fixture-device',
      },
      {
        id: buildDevicePathId('other-device'),
        userId: user.id,
        identifier: 'other-device',
      },
      {
        id: 'external-user:device',
        userId: 'external-user',
        identifier: 'external-device',
      },
    ]
    const refreshTokens = [
      { id: 'current-token', userId: user.id },
      { id: 'other-token', userId: user.id },
      { id: 'external-token', userId: 'external-user' },
    ]
    const database = new FakeD1Database(null, [], {
      authUser: user,
      devices,
      refreshTokens,
      authRequests: [approvedAuthRequest],
      requestQuotaBucket: unblockedRequestQuotaBucket(),
    })
    const notificationFetch = vi
      .fn()
      .mockResolvedValue(Response.json({ invalidated: 2 }))
    const notificationHub = {
      idFromName: vi.fn((name: string) => `do:${name}`),
      get: vi.fn(() => ({ fetch: notificationFetch })),
    }
    const bindings = {
      DB: database,
      NOTIFICATION_HUB: notificationHub as unknown as DurableObjectNamespace,
      HONOWARDEN_AUDIT_LOGS: 'true',
      HONOWARDEN_AUTH_REQUESTS_ENABLED: 'true',
      HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED: 'true',
      HONOWARDEN_AUTH_REQUEST_SECRET: authRequestSecret,
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
    }
    const response = await app.request(
      '/api/accounts/security-stamp',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'security-stamp-rotation-request',
        },
        body: JSON.stringify({
          masterPasswordHash: user.masterPasswordHash,
        }),
      },
      bindings,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.text()).resolves.toBe('')
    expect(user.securityStamp).not.toBe('security-stamp')
    expect(user.revisionDate).not.toBe('2026-07-06T00:00:00.000Z')
    expect(devices.slice(0, 2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ revokedAt: expect.any(String) }),
        expect.objectContaining({ revokedAt: expect.any(String) }),
      ]),
    )
    expect(devices[2]).not.toHaveProperty('revokedAt')
    expect(refreshTokens.slice(0, 2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ revokedAt: expect.any(String) }),
        expect.objectContaining({ revokedAt: expect.any(String) }),
      ]),
    )
    expect(refreshTokens[2]).not.toHaveProperty('revokedAt')
    expect(approvedAuthRequest).toMatchObject({
      status: 'superseded',
      requestApproved: 0,
      encryptedResponseKey: null,
    })
    expect(database.auditEventInserts).toEqual([
      expect.objectContaining({
        name: 'account.security_stamp.rotate',
        outcome: 'success',
        requestId: 'security-stamp-rotation-request',
        actorUserId: user.id,
        actorDeviceIdentifier: 'fixture-device',
        targetType: 'account',
        targetId: user.id,
      }),
    ])
    expect(notificationHub.idFromName).toHaveBeenCalledWith(user.id)
    expect(notificationFetch).toHaveBeenCalledOnce()
    const invalidationRequest = notificationFetch.mock.calls[0]?.[0] as Request
    expect(invalidationRequest.url).toBe('https://notification-hub/invalidate')
    expect(invalidationRequest.method).toBe('POST')
    expect(
      invalidationRequest.headers.get(notificationSecurityStampHeader),
    ).toBe(user.securityStamp)
    expect(
      invalidationRequest.headers.get(notificationCredentialRevisionHeader),
    ).toBe(user.revisionDate)
    expect(auditLog).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(database.auditEventInserts)).not.toContain(
      user.masterPasswordHash,
    )
    expect(JSON.stringify(auditLog.mock.calls)).not.toContain(accessToken)

    const oldTokenResponse = await app.request(
      '/api/sync',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      bindings,
    )
    expect(oldTokenResponse.status).toBe(401)
    await expect(oldTokenResponse.json()).resolves.toMatchObject({
      error: { code: 'invalid_token' },
    })

    const staleApprovalResponse = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          username: user.email,
          password: authRequestAccessCode,
          authRequest: 'auth-request-id',
          deviceType: '8',
          deviceIdentifier: 'requester-device',
          deviceName: 'Requester',
        }),
      },
      bindings,
    )
    expect(staleApprovalResponse.status).toBe(400)
    await expect(staleApprovalResponse.json()).resolves.toMatchObject({
      error: 'invalid_grant',
    })
  })

  it('reports incomplete durable notification cleanup after committing rotation', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = authUserRecord()
    const previousSecurityStamp = user.securityStamp
    const database = new FakeD1Database(null, [], { authUser: user })
    const response = await app.request(
      '/api/accounts/security-stamp',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await recentPasswordAccessTokenFor(user)}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'security-stamp-notification-failure-request',
        },
        body: JSON.stringify({
          masterPasswordHash: user.masterPasswordHash,
        }),
      },
      {
        DB: database,
        NOTIFICATION_HUB: {
          idFromName: () => 'user-object',
          get: () => ({
            fetch: vi.fn().mockRejectedValue(new Error('do unavailable')),
          }),
        } as unknown as DurableObjectNamespace,
        HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'session_revocation_incomplete',
        message:
          'Account credentials rotated, but notification session cleanup is incomplete.',
      },
      requestId: 'security-stamp-notification-failure-request',
    })
    expect(user.securityStamp).not.toBe(previousSecurityStamp)
    expect(database.auditEventInserts).toHaveLength(1)
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining(
        'account_notification_session_invalidation_failed',
      ),
    )
  })

  it('rejects rotation before mutation when durable notification binding is missing', async () => {
    const user = authUserRecord()
    const previousSecurityStamp = user.securityStamp
    const database = new FakeD1Database(null, [], { authUser: user })
    const response = await app.request(
      '/api/accounts/security-stamp',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await recentPasswordAccessTokenFor(user)}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'security-stamp-notification-misconfigured-request',
        },
        body: JSON.stringify({
          masterPasswordHash: user.masterPasswordHash,
        }),
      },
      {
        DB: database,
        HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'server_misconfigured',
        message: 'Notification hub is unavailable.',
      },
      requestId: 'security-stamp-notification-misconfigured-request',
    })
    expect(user.securityStamp).toBe(previousSecurityStamp)
    expect(database.auditEventInserts).toEqual([])
  })

  it('persists mandatory stamp-rotation audit without emitting disabled console logs', async () => {
    const auditLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    const user = authUserRecord()
    const database = new FakeD1Database(null, [], { authUser: user })
    const response = await app.request(
      '/api/accounts/security-stamp',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await recentPasswordAccessTokenFor(user)}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'security-stamp-disabled-audit-log-request',
        },
        body: JSON.stringify({
          masterPasswordHash: user.masterPasswordHash,
        }),
      },
      {
        DB: database,
        HONOWARDEN_AUDIT_LOGS: 'false',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    expect(database.auditEventInserts).toEqual([
      expect.objectContaining({
        name: 'account.security_stamp.rotate',
        outcome: 'success',
        requestId: 'security-stamp-disabled-audit-log-request',
      }),
    ])
    expect(auditLog).not.toHaveBeenCalled()
  })

  it('records invalid security-stamp proofs without mutating credentials', async () => {
    const user = authUserRecord()
    const database = new FakeD1Database(null, [], { authUser: user })
    const prepare = vi.spyOn(database, 'prepare')
    const accessToken = await recentPasswordAccessTokenFor(user)
    const before = {
      masterPasswordHash: user.masterPasswordHash,
      revisionDate: user.revisionDate,
      securityStamp: user.securityStamp,
    }
    const response = await app.request(
      '/api/accounts/security-stamp',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'CF-Connecting-IP': '203.0.113.27',
          'Content-Type': 'application/json',
          'X-Request-Id': 'invalid-security-stamp-proof-request',
        },
        body: JSON.stringify({ masterPasswordHash: 'wrong-hash' }),
      },
      {
        DB: database,
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
        message: 'The supplied credentials are invalid.',
      },
      requestId: 'invalid-security-stamp-proof-request',
    })
    expect({
      masterPasswordHash: user.masterPasswordHash,
      revisionDate: user.revisionDate,
      securityStamp: user.securityStamp,
    }).toEqual(before)
    expect(database.auditEventInserts).toEqual([])
    const queries = prepare.mock.calls.map(([query]) => query)
    expect(
      queries.filter((query) => query.includes('INSERT INTO auth_attempts')),
    ).toHaveLength(1)
    expect(
      queries.filter((query) =>
        query.includes('INSERT INTO auth_failure_buckets'),
      ),
    ).toHaveLength(2)
    expect(
      queries.some((query) => query.includes('login_failed_count = ?')),
    ).toBe(true)
  })

  it('locks repeated stamp proofs before mutation and rate limits their IP bucket', async () => {
    const user = authUserRecord()
    const database = new FakeD1Database(null, [], { authUser: user })
    const accessToken = await recentPasswordAccessTokenFor(user)
    const request = async (masterPasswordHash: string) =>
      app.request(
        '/api/accounts/security-stamp',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'CF-Connecting-IP': '203.0.113.28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ masterPasswordHash }),
        },
        {
          DB: database,
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        },
      )

    for (
      let attempt = 0;
      attempt < loginDefensePolicy.accountFailureLimit;
      attempt += 1
    ) {
      const response = await request(`wrong-hash-${attempt}`)
      expect(response.status).toBe(400)
    }

    const blockedValidProof = await request(user.masterPasswordHash)
    expect(blockedValidProof.status).toBe(400)
    expect(user.securityStamp).toBe('security-stamp')

    const remainingIpAttempts =
      loginDefensePolicy.ipFailureLimit -
      loginDefensePolicy.accountFailureLimit -
      1
    for (let attempt = 0; attempt < remainingIpAttempts; attempt += 1) {
      const response = await request(user.masterPasswordHash)
      const reachesIpLimit = attempt === remainingIpAttempts - 1
      expect(response.status).toBe(reachesIpLimit ? 429 : 400)
      if (reachesIpLimit) {
        expect(response.headers.get('Retry-After')).toBe(
          String(loginDefensePolicy.ipRetryAfterSeconds),
        )
      }
    }

    const blockedIpProof = await request(user.masterPasswordHash)
    expect(blockedIpProof.status).toBe(429)
    expect(blockedIpProof.headers.get('Retry-After')).toBe(
      String(loginDefensePolicy.ipRetryAfterSeconds),
    )
    expect(user.securityStamp).toBe('security-stamp')
    expect(database.auditEventInserts).toEqual([])
  })

  it('returns a revision conflict without partial session or audit changes', async () => {
    const user = authUserRecord()
    const devices = [
      {
        id: buildDevicePathId('fixture-device'),
        userId: user.id,
        identifier: 'fixture-device',
      },
    ]
    const refreshTokens = [{ id: 'current-token', userId: user.id }]
    const database = new FakeD1Database(null, [], {
      authUser: user,
      devices,
      refreshTokens,
      credentialRotationConflict: true,
    })
    const before = structuredClone({ user, devices, refreshTokens })
    const response = await app.request(
      '/api/accounts/security-stamp',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await recentPasswordAccessTokenFor(user)}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'security-stamp-conflict-request',
        },
        body: JSON.stringify({
          masterPasswordHash: user.masterPasswordHash,
        }),
      },
      {
        DB: database,
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'revision_conflict' },
      requestId: 'security-stamp-conflict-request',
    })
    expect({ user, devices, refreshTokens }).toEqual(before)
    expect(database.auditEventInserts).toEqual([])
  })

  it('requires a supported body and recent password authentication for stamp rotation', async () => {
    const user = authUserRecord()
    const database = new FakeD1Database(null, [], { authUser: user })

    const malformed = await app.request(
      '/api/accounts/security-stamp',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await recentPasswordAccessTokenFor(user)}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'malformed-security-stamp-request',
        },
        body: JSON.stringify({ otp: 'unsupported' }),
      },
      {
        DB: database,
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )
    expect(malformed.status).toBe(400)
    await expect(malformed.json()).resolves.toMatchObject({
      error: { code: 'invalid_request' },
    })

    for (const accessToken of [
      await refreshAccessTokenFor(user),
      await stalePasswordAccessTokenFor(user),
    ]) {
      const response = await app.request(
        '/api/accounts/security-stamp',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            MasterPasswordHash: user.masterPasswordHash,
          }),
        },
        {
          DB: database,
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        },
      )
      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'reauth_required' },
      })
    }
    expect(database.auditEventInserts).toEqual([])
  })

  it('rolls back stamp and sessions when mandatory audit persistence fails', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = authUserRecord()
    const devices = [
      {
        id: buildDevicePathId('fixture-device'),
        userId: user.id,
        identifier: 'fixture-device',
      },
    ]
    const refreshTokens = [{ id: 'current-token', userId: user.id }]
    const database = new FakeD1Database(null, [], {
      authUser: user,
      devices,
      refreshTokens,
      credentialRotationFailureAt: 'audit',
    })
    const before = structuredClone({ user, devices, refreshTokens })
    const response = await app.request(
      '/api/accounts/security-stamp',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await recentPasswordAccessTokenFor(user)}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'security-stamp-audit-failure-request',
        },
        body: JSON.stringify({
          masterPasswordHash: user.masterPasswordHash,
        }),
      },
      {
        DB: database,
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'database_unavailable',
        message: 'Security-stamp rotation failed.',
      },
      requestId: 'security-stamp-audit-failure-request',
    })
    expect({ user, devices, refreshTokens }).toEqual(before)
    expect(database.auditEventInserts).toEqual([])
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('account_security_stamp_rotation_failed'),
    )
  })

  it('lists folders for the authenticated user', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/folders',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          folders: [
            {
              id: 'folder-id',
              userId: 'user-id',
              name: '2.encrypted-folder-name',
              revisionDate: '2026-07-06T00:03:00.000Z',
            },
            {
              id: 'deleted-folder-id',
              userId: 'user-id',
              name: '2.deleted-folder-name',
              revisionDate: '2026-07-06T00:04:00.000Z',
              deletedAt: '2026-07-06T00:04:00.000Z',
            },
            {
              id: 'other-folder-id',
              userId: 'other-user',
              name: '2.other-folder-name',
              revisionDate: '2026-07-06T00:05:00.000Z',
            },
          ],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      object: 'list',
      data: [
        {
          object: 'folder',
          id: 'folder-id',
          name: '2.encrypted-folder-name',
          revisionDate: '2026-07-06T00:03:00.000Z',
        },
      ],
      continuationToken: null,
    })
  })

  it('rejects vault mutations for disabled users', async () => {
    const user = {
      ...authUserRecord(),
      disabledAt: '2026-07-06T00:00:00.000Z',
    }
    const accessToken = await accessTokenFor(user)

    for (const request of [
      {
        path: '/api/folders',
        body: {
          name: '2.encrypted-folder-name',
        },
      },
      {
        path: '/api/ciphers',
        body: cipherCreateBody(),
      },
    ]) {
      const response = await app.request(
        request.path,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request.body),
        },
        {
          DB: new FakeD1Database(null, [], {
            authUser: user,
          }),
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        },
      )

      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: 'invalid_token',
        },
      })
    }
  })

  it('paginates folders with stable continuation tokens', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const database = new FakeD1Database(null, [], {
      authUser: user,
      folders: [
        {
          id: 'folder-one',
          userId: 'user-id',
          name: '2.encrypted-folder-one',
          revisionDate: '2026-07-06T00:01:00.000Z',
        },
        {
          id: 'folder-two',
          userId: 'user-id',
          name: '2.encrypted-folder-two',
          revisionDate: '2026-07-06T00:02:00.000Z',
        },
        {
          id: 'folder-three',
          userId: 'user-id',
          name: '2.encrypted-folder-three',
          revisionDate: '2026-07-06T00:03:00.000Z',
        },
        {
          id: 'deleted-folder',
          userId: 'user-id',
          name: '2.deleted-folder',
          revisionDate: '2026-07-06T00:04:00.000Z',
          deletedAt: '2026-07-06T00:04:00.000Z',
        },
      ],
    })

    const firstPage = await app.request(
      '/api/folders?pageSize=1',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: database,
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(firstPage.status).toBe(200)
    const firstBody = (await firstPage.json()) as {
      data: Array<{ id: string }>
      continuationToken: string | null
    }
    expect(firstBody.data.map((folder) => folder.id)).toEqual(['folder-one'])
    expect(firstBody.continuationToken).toEqual(expect.any(String))

    const secondPage = await app.request(
      `/api/folders?pageSize=1&continuationToken=${encodeURIComponent(firstBody.continuationToken ?? '')}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: database,
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(secondPage.status).toBe(200)
    const secondBody = (await secondPage.json()) as {
      data: Array<{ id: string }>
      continuationToken: string | null
    }
    expect(secondBody.data.map((folder) => folder.id)).toEqual(['folder-two'])
    expect(secondBody.continuationToken).toEqual(expect.any(String))

    const crossResourceToken = await app.request(
      `/api/ciphers?pageSize=1&continuationToken=${encodeURIComponent(firstBody.continuationToken ?? '')}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: database,
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(crossResourceToken.status).toBe(400)
    await expect(crossResourceToken.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
      },
    })
  })

  it('gets a folder by id for the authenticated user', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/folders/folder-id',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          folders: [
            {
              id: 'folder-id',
              userId: 'user-id',
              name: '2.encrypted-folder-name',
              revisionDate: '2026-07-06T00:03:00.000Z',
            },
            {
              id: 'folder-id',
              userId: 'other-user',
              name: '2.other-folder-name',
              revisionDate: '2026-07-06T00:04:00.000Z',
            },
          ],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      object: 'folder',
      id: 'folder-id',
      name: '2.encrypted-folder-name',
      revisionDate: '2026-07-06T00:03:00.000Z',
    })
  })

  it('returns not found for missing, deleted, or cross-user folder reads', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)

    for (const path of [
      '/api/folders/missing-folder-id',
      '/api/folders/deleted-folder-id',
      '/api/folders/other-folder-id',
    ]) {
      const response = await app.request(
        path,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
        {
          DB: new FakeD1Database(null, [], {
            authUser: user,
            folders: [
              {
                id: 'deleted-folder-id',
                userId: 'user-id',
                name: '2.deleted-folder-name',
                revisionDate: '2026-07-06T00:03:00.000Z',
                deletedAt: '2026-07-06T00:04:00.000Z',
              },
              {
                id: 'other-folder-id',
                userId: 'other-user',
                name: '2.other-folder-name',
                revisionDate: '2026-07-06T00:05:00.000Z',
              },
            ],
          }),
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        },
      )

      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: 'folder_not_found',
        },
      })
    }
  })

  it('creates a folder for the authenticated user', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/folders',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: '2.encrypted-folder-name',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      object: 'folder',
      id: expect.any(String),
      name: '2.encrypted-folder-name',
      revisionDate: expect.any(String),
    })
  })

  it('rejects malformed folder create requests', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/folders',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'folder-invalid-body-request',
        },
        body: JSON.stringify({
          name: '',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
      },
      requestId: 'folder-invalid-body-request',
    })
  })

  it('updates a folder for the authenticated user', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/folders/folder-id',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: '2.updated-encrypted-folder-name',
          revisionDate: '2026-07-06T00:00:00.000Z',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          folderUpdateChanges: 1,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: 'folder',
      id: 'folder-id',
      name: '2.updated-encrypted-folder-name',
      revisionDate: expect.any(String),
    })
  })

  it('rejects folder update without a revision date', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/folders/folder-id',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'folder-update-missing-revision-request',
        },
        body: JSON.stringify({
          name: '2.updated-encrypted-folder-name',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
      },
      requestId: 'folder-update-missing-revision-request',
    })
  })

  it('returns not found when updating a missing or cross-user folder', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/folders/folder-id',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: '2.updated-encrypted-folder-name',
          revisionDate: '2026-07-06T00:00:00.000Z',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          folderUpdateChanges: 0,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'folder_not_found',
      },
    })
  })

  it('returns conflict when updating a stale folder revision', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/folders/folder-id',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'folder-update-conflict-request',
        },
        body: JSON.stringify({
          name: '2.updated-encrypted-folder-name',
          revisionDate: '2026-07-06T00:00:00.000Z',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          folder: {
            revisionDate: '2026-07-06T00:00:30.000Z',
          },
          folderUpdateChanges: 0,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'revision_conflict',
      },
      requestId: 'folder-update-conflict-request',
    })
  })

  it('soft-deletes a folder for the authenticated user', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/folders/folder-id',
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          folderDeleteChanges: 1,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: 'folderDeletion',
      id: 'folder-id',
      revisionDate: expect.any(String),
    })
  })

  it('emits secret-safe audit events for folder mutations', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const database = new FakeD1Database(null, [], {
      authUser: user,
      folderDeleteChanges: 1,
      folderUpdateChanges: 1,
    })
    const env = {
      DB: database,
      HONOWARDEN_AUDIT_LOGS: 'true',
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
    }

    const createResponse = await app.request(
      '/api/folders',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'audit-folder-create-request',
        },
        body: JSON.stringify({
          name: '2.encrypted-folder-name',
        }),
      },
      env,
    )
    const updateResponse = await app.request(
      '/api/folders/folder-id',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'audit-folder-update-request',
        },
        body: JSON.stringify({
          name: '2.updated-encrypted-folder-name',
          revisionDate: '2026-07-06T00:00:00.000Z',
        }),
      },
      env,
    )
    const deleteResponse = await app.request(
      '/api/folders/folder-id',
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'audit-folder-delete-request',
        },
      },
      env,
    )

    expect(createResponse.status).toBe(201)
    expect(updateResponse.status).toBe(200)
    expect(deleteResponse.status).toBe(200)
    expect(database.auditEventInserts.map((event) => event.name)).toEqual([
      'folder.create',
      'folder.update',
      'folder.delete',
    ])
    expect(database.auditEventInserts).toEqual([
      expect.objectContaining({
        outcome: 'success',
        requestId: 'audit-folder-create-request',
        actorUserId: 'user-id',
        actorDeviceIdentifier: 'fixture-device',
        targetType: 'folder',
        contextJson: JSON.stringify({ resultStatus: 'created' }),
      }),
      expect.objectContaining({
        outcome: 'success',
        requestId: 'audit-folder-update-request',
        actorUserId: 'user-id',
        actorDeviceIdentifier: 'fixture-device',
        targetType: 'folder',
        targetId: 'folder-id',
        contextJson: JSON.stringify({ resultStatus: 'updated' }),
      }),
      expect.objectContaining({
        outcome: 'success',
        requestId: 'audit-folder-delete-request',
        actorUserId: 'user-id',
        actorDeviceIdentifier: 'fixture-device',
        targetType: 'folder',
        targetId: 'folder-id',
        contextJson: JSON.stringify({ resultStatus: 'deleted' }),
      }),
    ])
    expect(JSON.stringify(database.auditEventInserts)).not.toContain(
      '2.encrypted-folder-name',
    )
    expect(JSON.stringify(database.auditEventInserts)).not.toContain(
      'test-token-secret',
    )
    expect(JSON.stringify(database.auditEventInserts)).not.toContain(
      accessToken,
    )
  })

  it('returns not found when deleting a missing or cross-user folder', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/folders/folder-id',
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          folderDeleteChanges: 0,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'folder_not_found',
      },
    })
  })

  it('lists ciphers for the authenticated user including trashed ciphers', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/ciphers',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          ciphers: [
            {
              id: 'cipher-id',
              userId: 'user-id',
              folderId: 'folder-id',
              type: 1,
              favorite: 1,
              encryptedJson: JSON.stringify(cipherCreateBody()),
              revisionDate: '2026-07-06T00:05:00.000Z',
              createdAt: '2026-07-06T00:04:00.000Z',
            },
            {
              id: 'trashed-cipher-id',
              userId: 'user-id',
              folderId: null,
              type: 2,
              favorite: 0,
              encryptedJson: JSON.stringify({
                type: 2,
                favorite: false,
                name: '2.trashed-encrypted-note',
                secureNote: {
                  type: 0,
                },
              }),
              revisionDate: '2026-07-06T00:06:00.000Z',
              createdAt: '2026-07-06T00:04:30.000Z',
              deletedAt: '2026-07-06T00:06:00.000Z',
            },
            {
              id: 'other-cipher-id',
              userId: 'other-user',
              folderId: null,
              type: 1,
              favorite: 0,
              encryptedJson: JSON.stringify(cipherCreateBody()),
              revisionDate: '2026-07-06T00:07:00.000Z',
              createdAt: '2026-07-06T00:05:00.000Z',
            },
          ],
          attachments: [attachmentRecord()],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: Array<{ attachments?: unknown[] }>
    }
    expect(body).toMatchObject({
      object: 'list',
      data: [
        {
          object: 'cipher',
          id: 'cipher-id',
          folderId: 'folder-id',
          type: 1,
          favorite: true,
          name: '2.encrypted-cipher-name',
          deletedDate: null,
          attachments: [
            {
              id: 'attachment-id',
              url: '/api/ciphers/cipher-id/attachment/attachment-id',
              fileName: '2.encrypted-file-name',
              key: '2.encrypted-attachment-key',
              size: '15',
              sizeName: '15 B',
            },
          ],
        },
        {
          object: 'cipher',
          id: 'trashed-cipher-id',
          folderId: null,
          type: 2,
          favorite: false,
          name: '2.trashed-encrypted-note',
          deletedDate: '2026-07-06T00:06:00.000Z',
        },
      ],
      continuationToken: null,
    })
    expectOfficialAttachmentFieldTypes(body.data[0]?.attachments?.[0])
  })

  it('paginates ciphers including trashed rows and rejects bad tokens', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const database = new FakeD1Database(null, [], {
      authUser: user,
      ciphers: [
        {
          id: 'cipher-one',
          userId: 'user-id',
          folderId: null,
          type: 1,
          favorite: 0,
          encryptedJson: JSON.stringify(cipherCreateBody()),
          revisionDate: '2026-07-06T00:01:00.000Z',
          createdAt: '2026-07-06T00:01:00.000Z',
        },
        {
          id: 'cipher-two',
          userId: 'user-id',
          folderId: null,
          type: 2,
          favorite: 0,
          encryptedJson: JSON.stringify({
            type: 2,
            favorite: false,
            name: '2.trashed-note',
            secureNote: {
              type: 0,
            },
          }),
          revisionDate: '2026-07-06T00:02:00.000Z',
          createdAt: '2026-07-06T00:02:00.000Z',
          deletedAt: '2026-07-06T00:02:00.000Z',
        },
      ],
    })

    const firstPage = await app.request(
      '/api/ciphers?pageSize=1',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: database,
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(firstPage.status).toBe(200)
    const firstBody = (await firstPage.json()) as {
      data: Array<{ id: string; deletedDate?: string | null }>
      continuationToken: string | null
    }
    expect(firstBody.data.map((cipher) => cipher.id)).toEqual(['cipher-one'])
    expect(firstBody.continuationToken).toEqual(expect.any(String))

    const secondPage = await app.request(
      `/api/ciphers?pageSize=1&continuationToken=${encodeURIComponent(firstBody.continuationToken ?? '')}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: database,
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(secondPage.status).toBe(200)
    const secondBody = (await secondPage.json()) as {
      data: Array<{ id: string; deletedDate?: string | null }>
      continuationToken: string | null
    }
    expect(secondBody.data).toMatchObject([
      {
        id: 'cipher-two',
        deletedDate: '2026-07-06T00:02:00.000Z',
      },
    ])
    expect(secondBody.continuationToken).toBeNull()

    const invalidToken = await app.request(
      '/api/ciphers?continuationToken=not-valid',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: database,
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(invalidToken.status).toBe(400)
    await expect(invalidToken.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
      },
    })
  })

  it('gets a cipher by id for the authenticated user', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/ciphers/cipher-id',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          ciphers: [
            {
              id: 'cipher-id',
              userId: 'user-id',
              folderId: 'folder-id',
              type: 1,
              favorite: 1,
              encryptedJson: JSON.stringify({
                ...cipherCreateBody(),
                futureEncryptedShape: {
                  value: '2.encrypted-future-field',
                },
              }),
              revisionDate: '2026-07-06T00:05:00.000Z',
              createdAt: '2026-07-06T00:04:00.000Z',
            },
            {
              id: 'cipher-id',
              userId: 'other-user',
              folderId: null,
              type: 1,
              favorite: 0,
              encryptedJson: JSON.stringify(cipherCreateBody()),
              revisionDate: '2026-07-06T00:06:00.000Z',
              createdAt: '2026-07-06T00:05:00.000Z',
            },
          ],
          attachments: [attachmentRecord()],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown> & {
      attachments?: unknown[]
    }
    expect(body).toEqual({
      ...cipherCreateBody(),
      futureEncryptedShape: {
        value: '2.encrypted-future-field',
      },
      attachments: [
        {
          id: 'attachment-id',
          url: '/api/ciphers/cipher-id/attachment/attachment-id',
          fileName: '2.encrypted-file-name',
          key: '2.encrypted-attachment-key',
          size: '15',
          sizeName: '15 B',
        },
      ],
      object: 'cipher',
      id: 'cipher-id',
      organizationId: null,
      folderId: 'folder-id',
      type: 1,
      favorite: true,
      name: '2.encrypted-cipher-name',
      edit: true,
      viewPassword: true,
      organizationUseTotp: false,
      collectionIds: [],
      permissions: {
        delete: true,
        restore: true,
      },
      revisionDate: '2026-07-06T00:05:00.000Z',
      creationDate: '2026-07-06T00:04:00.000Z',
      deletedDate: null,
    })
    expectOfficialAttachmentFieldTypes(body.attachments?.[0])
  })

  it('gets a trashed cipher by id for the authenticated user', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/ciphers/trashed-cipher-id',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          ciphers: [
            {
              id: 'trashed-cipher-id',
              userId: 'user-id',
              folderId: null,
              type: 1,
              favorite: 0,
              encryptedJson: JSON.stringify({
                ...cipherCreateBody(),
                folderId: null,
                name: '2.trashed-encrypted-cipher-name',
              }),
              revisionDate: '2026-07-06T00:06:00.000Z',
              createdAt: '2026-07-06T00:04:30.000Z',
              deletedAt: '2026-07-06T00:06:00.000Z',
            },
          ],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: 'cipher',
      id: 'trashed-cipher-id',
      folderId: null,
      favorite: false,
      name: '2.trashed-encrypted-cipher-name',
      revisionDate: '2026-07-06T00:06:00.000Z',
      creationDate: '2026-07-06T00:04:30.000Z',
      deletedDate: '2026-07-06T00:06:00.000Z',
    })
  })

  it('returns not found for missing or cross-user cipher reads', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)

    for (const path of [
      '/api/ciphers/missing-cipher-id',
      '/api/ciphers/other-cipher-id',
    ]) {
      const response = await app.request(
        path,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-Request-Id': 'opaque-cipher-not-found-request',
          },
        },
        {
          DB: new FakeD1Database(null, [], {
            authUser: user,
            ciphers: [
              {
                id: 'other-cipher-id',
                userId: 'other-user',
                folderId: null,
                type: 1,
                favorite: 0,
                encryptedJson: JSON.stringify(cipherCreateBody()),
                revisionDate: '2026-07-06T00:07:00.000Z',
                createdAt: '2026-07-06T00:05:00.000Z',
              },
            ],
          }),
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        },
      )

      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toEqual({
        error: {
          code: 'cipher_not_found',
          message: 'Cipher was not found.',
        },
        requestId: 'opaque-cipher-not-found-request',
      })
    }
  })

  it('creates a login cipher for the authenticated user', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/ciphers',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(cipherCreateBody()),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          folder: {
            id: 'folder-id',
          },
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      object: 'cipher',
      id: expect.any(String),
      organizationId: null,
      folderId: 'folder-id',
      type: 1,
      favorite: true,
      edit: true,
      viewPassword: true,
      organizationUseTotp: false,
      collectionIds: [],
      permissions: {
        delete: true,
        restore: true,
      },
      name: '2.encrypted-cipher-name',
      login: {
        username: '2.encrypted-username',
        password: '2.encrypted-password',
      },
      revisionDate: expect.any(String),
      creationDate: expect.any(String),
      deletedDate: null,
    })
  })

  it('normalizes CLI attachment maps in cipher responses without changing stored payloads', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/ciphers',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...cipherCreateBody(),
          attachments: {},
          attachments2: {},
          permissions: {},
          collectionIds: [42, 'collection-id'],
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          folder: {
            id: 'folder-id',
          },
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body).toMatchObject({
      attachments: [],
      collectionIds: ['collection-id'],
      permissions: {
        delete: true,
        restore: true,
      },
    })
    expect(body).not.toHaveProperty('attachments2')
  })

  it('uploads encrypted attachment bytes to an opaque R2 object key', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const bucket = new FakeR2Bucket()
    const form = new FormData()
    form.set('fileName', '2.encrypted-file-name')
    form.set('key', '2.encrypted-attachment-key')
    form.set(
      'file',
      new Blob(['encrypted-bytes'], {
        type: 'application/octet-stream',
      }),
      'plaintext-name-is-not-used.bin',
    )

    const response = await app.request(
      '/api/ciphers/cipher-id/attachment',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'attachment-upload-request',
        },
        body: form,
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          cipher: {
            id: 'cipher-id',
            userId: 'user-id',
            folderId: null,
            type: 1,
            favorite: 0,
            encryptedJson: JSON.stringify({
              type: 1,
              favorite: false,
              name: '2.encrypted-cipher-name',
            }),
            revisionDate: '2026-07-06T00:05:00.000Z',
            createdAt: '2026-07-06T00:04:00.000Z',
          },
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        VAULT_OBJECTS: bucket as unknown as R2Bucket,
      },
    )

    expect(response.status).toBe(201)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      object: 'attachment',
      id: expect.any(String),
      cipherId: 'cipher-id',
      fileName: '2.encrypted-file-name',
      key: '2.encrypted-attachment-key',
      size: '15',
      sizeName: '15 B',
      url: expect.stringContaining('/api/ciphers/cipher-id/attachment/'),
      revisionDate: expect.any(String),
    })
    expectOfficialAttachmentFieldTypes(body)
    expect(body).not.toHaveProperty('objectKey')
    expect(bucket.keys()).toHaveLength(1)
    const [objectKey] = bucket.keys()
    expect(objectKey).toMatch(/^attachments\/[0-9a-f-]{36}$/)
    expect(objectKey).not.toContain('user-id')
    expect(objectKey).not.toContain('cipher-id')
    expect(objectKey).not.toContain('file-name')
  })

  it('allocates attachment metadata for the official v2 Direct flow', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const bucket = new FakeR2Bucket()
    const attachments: Record<string, unknown>[] = []
    const response = await app.request(
      '/api/ciphers/cipher-id/attachment/v2',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          Key: '2.encrypted-attachment-key',
          FileName: '2.encrypted-file-name',
          FileSize: 15,
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          cipher: cipherRecord(),
          attachments,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        VAULT_OBJECTS: bucket as unknown as R2Bucket,
      },
    )

    expect(response.status).toBe(201)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      AttachmentId: expect.any(String),
      FileUploadType: 0,
      Url: expect.stringMatching(
        /^\/api\/ciphers\/cipher-id\/attachment\/[0-9a-f-]{36}$/,
      ),
      CipherResponse: {
        id: 'cipher-id',
        attachments: [
          {
            id: expect.any(String),
            fileName: '2.encrypted-file-name',
            key: '2.encrypted-attachment-key',
            size: '15',
            sizeName: '15 B',
          },
        ],
      },
      attachmentId: expect.any(String),
      fileUploadType: 0,
      url: expect.stringMatching(
        /^\/api\/ciphers\/cipher-id\/attachment\/[0-9a-f-]{36}$/,
      ),
      cipherResponse: {
        id: 'cipher-id',
        attachments: [
          {
            id: expect.any(String),
            fileName: '2.encrypted-file-name',
            key: '2.encrypted-attachment-key',
            size: '15',
            sizeName: '15 B',
          },
        ],
      },
    })
    const pascalCipherResponse = body.CipherResponse as {
      attachments?: unknown[]
    }
    const camelCipherResponse = body.cipherResponse as {
      attachments?: unknown[]
    }
    expectOfficialAttachmentFieldTypes(pascalCipherResponse.attachments?.[0])
    expectOfficialAttachmentFieldTypes(camelCipherResponse.attachments?.[0])
    expect(body.AttachmentId).toBe(body.attachmentId)
    expect(body.Url).toBe(body.url)
    expect(bucket.putKeys).toEqual([])
    expect(attachments).toEqual([
      expect.objectContaining({
        id: body.AttachmentId,
        cipherId: 'cipher-id',
        userId: 'user-id',
        contentType: null,
        uploadState: 'pending',
      }),
    ])
    const [objectKey] = attachments.map((attachment) => attachment.objectKey)
    expect(objectKey).toMatch(/^attachments\/[0-9a-f-]{36}$/)
    expect(objectKey).not.toContain('user-id')
    expect(objectKey).not.toContain('cipher-id')
    expect(objectKey).not.toContain('file-name')
  })

  it('accepts the official lower-camel v2 allocation fields', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const bucket = new FakeR2Bucket()
    const env = {
      DB: new FakeD1Database(null, [], {
        authUser: user,
        cipher: cipherRecord(),
        attachments: [],
      }),
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      VAULT_OBJECTS: bucket as unknown as R2Bucket,
    }
    const response = await app.request(
      '/api/ciphers/cipher-id/attachment/v2',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key: '2.encrypted-attachment-key',
          fileName: '2.encrypted-file-name',
          fileSize: 15,
        }),
      },
      env,
    )

    expect(response.status).toBe(201)
    const allocation = (await response.json()) as Record<string, unknown>
    expect(allocation).toMatchObject({
      AttachmentId: expect.any(String),
      FileUploadType: 0,
    })

    const form = new FormData()
    form.set(
      'data',
      new Blob(['encrypted-bytes'], { type: 'application/octet-stream' }),
      '2.encrypted-file-name',
    )
    const uploadResponse = await app.request(
      String(allocation.Url),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: form,
      },
      env,
    )

    expect(uploadResponse.status).toBe(204)
    expect(bucket.keys()).toHaveLength(1)
  })

  it.each([
    {
      name: 'missing cipher',
      ciphers: [],
    },
    {
      name: 'cross-user cipher',
      ciphers: [{ ...cipherRecord(), userId: 'other-user-id' }],
    },
    {
      name: 'deleted cipher',
      ciphers: [
        {
          ...cipherRecord(),
          deletedAt: '2026-07-12T00:00:00.000Z',
        },
      ],
    },
  ])(
    'rejects v2 allocation for a $name without R2 writes',
    async ({ ciphers }) => {
      const user = authUserRecord()
      const accessToken = await accessTokenFor(user)
      const bucket = new FakeR2Bucket()
      const attachments: Record<string, unknown>[] = []
      const response = await app.request(
        '/api/ciphers/cipher-id/attachment/v2',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            key: '2.encrypted-attachment-key',
            fileName: '2.encrypted-file-name',
            fileSize: 15,
          }),
        },
        {
          DB: new FakeD1Database(null, [], {
            authUser: user,
            ciphers,
            attachments,
          }),
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
          VAULT_OBJECTS: bucket as unknown as R2Bucket,
        },
      )

      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'cipher_not_found' },
      })
      expect(attachments).toEqual([])
      expect(bucket.putKeys).toEqual([])
    },
  )

  it('uploads and safely retries encrypted bytes for a pre-allocated attachment id', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const bucket = new FakeR2Bucket()
    const attachments = [pendingAttachmentRecord()]
    const database = new FakeD1Database(null, [], {
      authUser: user,
      ciphers: [cipherRecord()],
      attachments,
    })
    const env = {
      DB: database,
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      VAULT_OBJECTS: bucket as unknown as R2Bucket,
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const form = new FormData()
      form.set(
        'data',
        new Blob(['encrypted-bytes'], {
          type: 'application/octet-stream',
        }),
        '2.encrypted-file-name',
      )
      const response = await app.request(
        '/api/ciphers/cipher-id/attachment/attachment-id',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          body: form,
        },
        env,
      )

      expect(response.status).toBe(204)
    }

    expect(bucket.keys()).toEqual(['attachments/opaque-object-id'])
    expect(bucket.putKeys).toEqual([
      'attachments/opaque-object-id',
      'attachments/opaque-object-id',
    ])
    await expect(
      bucket
        .get('attachments/opaque-object-id')
        .then((object) => object?.text()),
    ).resolves.toBe('encrypted-bytes')
    expect(attachments).toEqual([
      expect.objectContaining({
        id: 'attachment-id',
        uploadState: 'uploaded',
        pendingExpiresAt: null,
      }),
    ])

    const profileResponse = await app.request(
      '/api/accounts/profile',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      env,
    )
    expect(profileResponse.status).toBe(200)
    await expect(profileResponse.json()).resolves.toMatchObject({
      storage: 15,
      maxStorageGb: 1,
      Storage: 15,
      MaxStorageGb: 1,
    })
  })

  it('keeps the shared object when concurrent retries race the uploaded-state transition', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const bucket = new TwoPutBarrierR2Bucket()
    const attachments = [pendingAttachmentRecord()]
    const env = {
      DB: new FakeD1Database(null, [], {
        authUser: user,
        ciphers: [cipherRecord()],
        attachments,
      }),
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      VAULT_OBJECTS: bucket as unknown as R2Bucket,
    }
    const upload = (contents: string) => {
      const form = new FormData()
      form.set(
        'data',
        new Blob([contents], { type: 'application/octet-stream' }),
        '2.encrypted-file-name',
      )

      return app.request(
        '/api/ciphers/cipher-id/attachment/attachment-id',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          body: form,
        },
        env,
      )
    }

    const responses = await Promise.all([
      upload('encrypted-one!!'),
      upload('encrypted-two!!'),
    ])

    expect(responses.map((response) => response.status)).toEqual([204, 204])
    expect(bucket.putKeys).toEqual([
      'attachments/opaque-object-id',
      'attachments/opaque-object-id',
    ])
    expect(bucket.deletedKeys).toEqual([])
    expect(bucket.keys()).toEqual(['attachments/opaque-object-id'])
    expect(attachments).toEqual([
      expect.objectContaining({
        id: 'attachment-id',
        uploadState: 'uploaded',
      }),
    ])
  })

  it.each([
    {
      name: 'missing cipher',
      ciphers: [],
      attachments: [pendingAttachmentRecord()],
      expectedCode: 'cipher_not_found',
    },
    {
      name: 'cross-user cipher',
      ciphers: [{ ...cipherRecord(), userId: 'other-user-id' }],
      attachments: [
        {
          ...pendingAttachmentRecord(),
          userId: 'other-user-id',
        },
      ],
      expectedCode: 'cipher_not_found',
    },
    {
      name: 'attachment id on another cipher',
      ciphers: [cipherRecord()],
      attachments: [
        {
          ...pendingAttachmentRecord(),
          cipherId: 'other-cipher-id',
        },
      ],
      expectedCode: 'attachment_not_found',
    },
    {
      name: 'missing attachment id',
      ciphers: [cipherRecord()],
      attachments: [],
      expectedCode: 'attachment_not_found',
    },
  ])(
    'rejects direct upload for $name before R2 writes',
    async ({ ciphers, attachments, expectedCode }) => {
      const user = authUserRecord()
      const accessToken = await accessTokenFor(user)
      const bucket = new FakeR2Bucket()
      const form = new FormData()
      form.set('data', new Blob(['encrypted-bytes']), 'encrypted-name')
      const response = await app.request(
        '/api/ciphers/cipher-id/attachment/attachment-id',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          body: form,
        },
        {
          DB: new FakeD1Database(null, [], {
            authUser: user,
            ciphers,
            attachments,
          }),
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
          VAULT_OBJECTS: bucket as unknown as R2Bucket,
        },
      )

      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: expectedCode },
      })
      expect(bucket.putKeys).toEqual([])
    },
  )

  it('renews the Direct upload URL without mutating a pending attachment', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const bucket = new FakeR2Bucket()
    const attachments = [pendingAttachmentRecord()]
    const response = await app.request(
      '/api/ciphers/cipher-id/attachment/attachment-id/renew',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          ciphers: [cipherRecord()],
          attachments,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        VAULT_OBJECTS: bucket as unknown as R2Bucket,
      },
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      AttachmentId: 'attachment-id',
      FileUploadType: 0,
      Url: '/api/ciphers/cipher-id/attachment/attachment-id',
      CipherResponse: {
        attachments: [
          {
            size: '15',
            sizeName: '15 B',
          },
        ],
      },
      attachmentId: 'attachment-id',
      fileUploadType: 0,
      url: '/api/ciphers/cipher-id/attachment/attachment-id',
      cipherResponse: {
        attachments: [
          {
            size: '15',
            sizeName: '15 B',
          },
        ],
      },
    })
    const renewedCipher = body.CipherResponse as { attachments?: unknown[] }
    expectOfficialAttachmentFieldTypes(renewedCipher.attachments?.[0])
    expect(attachments).toEqual([pendingAttachmentRecord()])
    expect(bucket.putKeys).toEqual([])
    expect(bucket.deletedKeys).toEqual([])
  })

  it('rolls back a pending allocation and releases its reserved quota', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const bucket = new FakeR2Bucket()
    const attachments = [
      {
        ...pendingAttachmentRecord(),
        size: testAttachmentStorageQuotaBytes,
      },
    ]
    const database = new FakeD1Database(null, [], {
      authUser: user,
      ciphers: [cipherRecord()],
      attachments,
    })
    const env = {
      DB: database,
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      VAULT_OBJECTS: bucket as unknown as R2Bucket,
    }

    const deleteResponse = await app.request(
      '/api/ciphers/cipher-id/attachment/attachment-id',
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      env,
    )

    expect(deleteResponse.status).toBe(200)
    expect(attachments).toEqual([])
    expect(bucket.keys()).toEqual([])

    const allocationResponse = await app.request(
      '/api/ciphers/cipher-id/attachment/v2',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key: '2.replacement-key',
          fileName: '2.replacement-name',
          fileSize: testAttachmentStorageQuotaBytes,
        }),
      },
      env,
    )
    expect(allocationResponse.status).toBe(201)
  })

  it.each([
    {
      name: 'account quota is already reserved',
      fileSize: 1,
      attachments: [
        {
          ...attachmentRecord(),
          size: testAttachmentStorageQuotaBytes,
        },
      ],
      expectedCode: 'attachment_storage_limit_exceeded',
      expectedStatus: 413,
    },
    {
      name: 'the attachment is individually oversized',
      fileSize: testAttachmentStorageQuotaBytes + 1,
      attachments: [],
      expectedCode: 'attachment_too_large',
      expectedStatus: 413,
    },
    {
      name: 'the encrypted payload is empty',
      fileSize: 0,
      attachments: [],
      expectedCode: 'invalid_request',
      expectedStatus: 400,
    },
  ])(
    'rejects v2 allocation when $name',
    async ({ fileSize, attachments, expectedCode, expectedStatus }) => {
      const user = authUserRecord()
      const accessToken = await accessTokenFor(user)
      const bucket = new FakeR2Bucket()
      const response = await app.request(
        '/api/ciphers/cipher-id/attachment/v2',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            key: '2.encrypted-attachment-key',
            fileName: '2.encrypted-file-name',
            fileSize,
          }),
        },
        {
          DB: new FakeD1Database(null, [], {
            authUser: user,
            ciphers: [cipherRecord()],
            attachments,
          }),
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
          VAULT_OBJECTS: bucket as unknown as R2Bucket,
        },
      )

      expect(response.status).toBe(expectedStatus)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: expectedCode },
      })
      expect(bucket.putKeys).toEqual([])
    },
  )

  it('rejects a direct upload whose encrypted byte count differs from its allocation', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const bucket = new FakeR2Bucket()
    const form = new FormData()
    form.set('data', new Blob(['wrong-size']), '2.encrypted-file-name')
    const response = await app.request(
      '/api/ciphers/cipher-id/attachment/attachment-id',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: form,
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          ciphers: [cipherRecord()],
          attachments: [pendingAttachmentRecord()],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        VAULT_OBJECTS: bucket as unknown as R2Bucket,
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'attachment_size_mismatch' },
    })
    expect(bucket.putKeys).toEqual([])
  })

  it('rejects direct upload when reserved account storage is over quota before R2 writes', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const bucket = new FakeR2Bucket()
    const form = new FormData()
    form.set('data', new Blob(['encrypted-bytes']), '2.encrypted-file-name')
    const response = await app.request(
      '/api/ciphers/cipher-id/attachment/attachment-id',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: form,
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          ciphers: [cipherRecord()],
          attachments: [
            {
              ...attachmentRecord(),
              id: 'existing-full-quota-attachment-id',
              objectKey: 'attachments/existing-full-quota-object-id',
              size: testAttachmentStorageQuotaBytes,
            },
            pendingAttachmentRecord(),
          ],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        VAULT_OBJECTS: bucket as unknown as R2Bucket,
      },
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'attachment_storage_limit_exceeded' },
    })
    expect(bucket.putKeys).toEqual([])
  })

  it('does not delete v2 bytes when audit persistence fails after upload state is durable', async () => {
    const auditLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const bucket = new FakeR2Bucket()
    const attachments = [pendingAttachmentRecord()]
    const form = new FormData()
    form.set('data', new Blob(['encrypted-bytes']), '2.encrypted-file-name')
    const response = await app.request(
      '/api/ciphers/cipher-id/attachment/attachment-id',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'v2-audit-attachment-create-failure-request',
        },
        body: form,
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          auditEventInsertThrows: true,
          ciphers: [cipherRecord()],
          attachments,
        }),
        HONOWARDEN_AUDIT_LOGS: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        VAULT_OBJECTS: bucket as unknown as R2Bucket,
      },
    )

    expect(response.status).toBe(503)
    expect(bucket.putKeys).toEqual(['attachments/opaque-object-id'])
    expect(bucket.deletedKeys).toEqual([])
    expect(bucket.has('attachments/opaque-object-id')).toBe(true)
    expect(attachments[0]).toMatchObject({ uploadState: 'uploaded' })
    auditLog.mockRestore()
  })

  it('rejects attachment upload for missing or cross-user ciphers before R2 writes', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const bucket = new FakeR2Bucket()
    const form = new FormData()
    form.set('fileName', '2.encrypted-file-name')
    form.set('key', '2.encrypted-attachment-key')
    form.set('file', new Blob(['encrypted-bytes']), 'ignored.bin')

    const response = await app.request(
      '/api/ciphers/missing-cipher-id/attachment',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: form,
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          cipher: null,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        VAULT_OBJECTS: bucket as unknown as R2Bucket,
      },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'cipher_not_found',
      },
    })
    expect(bucket.keys()).toEqual([])
  })

  it('enforces the storage quota on the legacy upload before R2 writes', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const bucket = new FakeR2Bucket()
    const form = new FormData()
    form.set('fileName', '2.encrypted-file-name')
    form.set('key', '2.encrypted-attachment-key')
    form.set('file', new Blob(['encrypted-bytes']), 'ignored.bin')
    const response = await app.request(
      '/api/ciphers/cipher-id/attachment',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: form,
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          cipher: cipherRecord(),
          attachments: [
            {
              ...attachmentRecord(),
              size: testAttachmentStorageQuotaBytes,
            },
          ],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        VAULT_OBJECTS: bucket as unknown as R2Bucket,
      },
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'attachment_storage_limit_exceeded' },
    })
    expect(bucket.putKeys).toEqual([])
  })

  it('does not delete uploaded attachment bytes when audit persistence fails after metadata create', async () => {
    const auditLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const bucket = new FakeR2Bucket()
    const form = new FormData()
    form.set('fileName', '2.encrypted-file-name')
    form.set('key', '2.encrypted-attachment-key')
    form.set('file', new Blob(['encrypted-bytes']), 'ignored.bin')

    const response = await app.request(
      '/api/ciphers/cipher-id/attachment',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'audit-attachment-create-failure-request',
        },
        body: form,
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          auditEventInsertThrows: true,
          cipher: {
            id: 'cipher-id',
            userId: 'user-id',
            folderId: null,
            type: 1,
            favorite: 0,
            encryptedJson: JSON.stringify({
              type: 1,
              favorite: false,
              name: '2.encrypted-cipher-name',
            }),
            revisionDate: '2026-07-06T00:05:00.000Z',
            createdAt: '2026-07-06T00:04:00.000Z',
          },
        }),
        HONOWARDEN_AUDIT_LOGS: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        VAULT_OBJECTS: bucket as unknown as R2Bucket,
      },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'storage_unavailable',
      },
    })
    expect(bucket.putKeys).toHaveLength(1)
    expect(bucket.deletedKeys).toEqual([])
    const [storedKey] = bucket.putKeys
    if (!storedKey) {
      throw new Error('Expected attachment upload to write an R2 object.')
    }
    expect(bucket.has(storedKey)).toBe(true)
    auditLog.mockRestore()
  })

  it('downloads encrypted attachment bytes for the owning cipher', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const bucket = new FakeR2Bucket()
    await bucket.put('attachments/opaque-object-id', 'encrypted-bytes', {
      httpMetadata: {
        contentType: 'application/octet-stream',
      },
    })

    const response = await app.request(
      '/api/ciphers/cipher-id/attachment/attachment-id',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          attachments: [attachmentRecord()],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        VAULT_OBJECTS: bucket as unknown as R2Bucket,
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe(
      'application/octet-stream',
    )
    await expect(response.text()).resolves.toBe('encrypted-bytes')
  })

  it('does not download cross-user attachment metadata', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const bucket = new FakeR2Bucket()
    await bucket.put('attachments/opaque-object-id', 'encrypted-bytes')

    const response = await app.request(
      '/api/ciphers/cipher-id/attachment/attachment-id',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          attachments: [
            {
              ...attachmentRecord(),
              userId: 'other-user-id',
            },
          ],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        VAULT_OBJECTS: bucket as unknown as R2Bucket,
      },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'attachment_not_found',
      },
    })
  })

  it('deletes attachment metadata and its R2 object for the owning cipher', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const bucket = new FakeR2Bucket()
    const attachments = [attachmentRecord()]
    const database = new FakeD1Database(null, [], {
      authUser: user,
      attachmentDeleteChanges: 1,
      attachments,
    })
    const env = {
      DB: database,
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      VAULT_OBJECTS: bucket as unknown as R2Bucket,
    }
    await bucket.put('attachments/opaque-object-id', 'encrypted-bytes')

    const profileBeforeDelete = await app.request(
      '/api/accounts/profile',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      env,
    )
    await expect(profileBeforeDelete.json()).resolves.toMatchObject({
      storage: 15,
    })

    const response = await app.request(
      '/api/ciphers/cipher-id/attachment/attachment-id',
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      env,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: 'attachmentDeletion',
      id: 'attachment-id',
      cipherId: 'cipher-id',
      revisionDate: expect.any(String),
    })
    expect(bucket.has('attachments/opaque-object-id')).toBe(false)
    expect(bucket.deletedKeys).toEqual(['attachments/opaque-object-id'])
    expect(attachments).toEqual([])

    const profileAfterDelete = await app.request(
      '/api/accounts/profile',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      env,
    )
    await expect(profileAfterDelete.json()).resolves.toMatchObject({
      storage: 0,
    })
  })

  it('emits secret-safe audit events for attachment mutations', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const bucket = new FakeR2Bucket()
    await bucket.put('attachments/opaque-object-id', 'encrypted-bytes')
    const database = new FakeD1Database(null, [], {
      authUser: user,
      attachmentDeleteChanges: 1,
      attachments: [attachmentRecord()],
      cipher: {
        id: 'cipher-id',
        userId: 'user-id',
        folderId: null,
        type: 1,
        favorite: 0,
        encryptedJson: JSON.stringify({
          type: 1,
          favorite: false,
          name: '2.encrypted-cipher-name',
        }),
        revisionDate: '2026-07-06T00:05:00.000Z',
        createdAt: '2026-07-06T00:04:00.000Z',
      },
    })
    const env = {
      DB: database,
      HONOWARDEN_AUDIT_LOGS: 'true',
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      VAULT_OBJECTS: bucket as unknown as R2Bucket,
    }
    const form = new FormData()
    form.set('fileName', '2.encrypted-file-name')
    form.set('key', '2.encrypted-attachment-key')
    form.set('file', new Blob(['encrypted-bytes']), 'ignored.bin')

    const uploadResponse = await app.request(
      '/api/ciphers/cipher-id/attachment',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'audit-attachment-create-request',
        },
        body: form,
      },
      env,
    )
    const deleteResponse = await app.request(
      '/api/ciphers/cipher-id/attachment/attachment-id',
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'audit-attachment-delete-request',
        },
      },
      env,
    )

    expect(uploadResponse.status).toBe(201)
    expect(deleteResponse.status).toBe(200)
    expect(database.auditEventInserts.map((event) => event.name)).toEqual([
      'attachment.create',
      'attachment.delete',
    ])
    expect(database.auditEventInserts).toEqual([
      expect.objectContaining({
        outcome: 'success',
        requestId: 'audit-attachment-create-request',
        actorUserId: 'user-id',
        actorDeviceIdentifier: 'fixture-device',
        targetType: 'attachment',
        contextJson: JSON.stringify({
          resultStatus: 'created',
          cipherId: 'cipher-id',
          size: 15,
        }),
      }),
      expect.objectContaining({
        outcome: 'success',
        requestId: 'audit-attachment-delete-request',
        actorUserId: 'user-id',
        actorDeviceIdentifier: 'fixture-device',
        targetType: 'attachment',
        targetId: 'attachment-id',
        contextJson: JSON.stringify({
          resultStatus: 'deleted',
          cipherId: 'cipher-id',
        }),
      }),
    ])
    const serialized = JSON.stringify(database.auditEventInserts)
    expect(serialized).not.toContain('2.encrypted-file-name')
    expect(serialized).not.toContain('2.encrypted-attachment-key')
    expect(serialized).not.toContain('attachments/opaque-object-id')
    expect(serialized).not.toContain('encrypted-bytes')
    expect(serialized).not.toContain(accessToken)
  })

  it('creates a secure-note cipher while preserving unknown encrypted fields', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/ciphers',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 2,
          favorite: false,
          name: '2.encrypted-note-name',
          secureNote: {
            type: 0,
          },
          notes: '2.encrypted-note-body',
          fields: [
            {
              name: '2.encrypted-field-name',
              value: '2.encrypted-field-value',
              type: 0,
            },
          ],
          unknownEncryptedEnvelope: {
            value: '2.encrypted-future-payload',
          },
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      object: 'cipher',
      id: expect.any(String),
      type: 2,
      favorite: false,
      name: '2.encrypted-note-name',
      secureNote: {
        type: 0,
      },
      notes: '2.encrypted-note-body',
      fields: [
        {
          name: '2.encrypted-field-name',
          value: '2.encrypted-field-value',
          type: 0,
        },
      ],
      unknownEncryptedEnvelope: {
        value: '2.encrypted-future-payload',
      },
      revisionDate: expect.any(String),
      creationDate: expect.any(String),
      deletedDate: null,
    })
  })

  it('keeps server-owned cipher metadata authoritative over request payload', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/ciphers',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...cipherCreateBody(),
          id: 'client-supplied-id',
          object: 'client-object',
          organizationId: 'client-org-id',
          revisionDate: '1999-01-01T00:00:00.000Z',
          creationDate: '1999-01-01T00:00:00.000Z',
          deletedDate: '1999-01-01T00:00:00.000Z',
          futureEncryptedShape: {
            value: '2.encrypted-future-field',
          },
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          folder: {
            id: 'folder-id',
          },
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(201)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.id).not.toBe('client-supplied-id')
    expect(body.object).toBe('cipher')
    expect(body.organizationId).toBeNull()
    expect(body.revisionDate).not.toBe('1999-01-01T00:00:00.000Z')
    expect(body.creationDate).not.toBe('1999-01-01T00:00:00.000Z')
    expect(body.deletedDate).toBeNull()
    expect(body.futureEncryptedShape).toEqual({
      value: '2.encrypted-future-field',
    })
  })

  it('includes active and trashed ciphers in sync', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/sync',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          ciphers: [
            {
              id: 'cipher-id',
              userId: 'user-id',
              folderId: 'folder-id',
              type: 1,
              favorite: 1,
              encryptedJson: JSON.stringify(cipherCreateBody()),
              revisionDate: '2026-07-06T00:05:00.000Z',
              createdAt: '2026-07-06T00:04:00.000Z',
            },
            {
              id: 'trashed-cipher-id',
              userId: 'user-id',
              folderId: null,
              type: 1,
              favorite: 0,
              encryptedJson: JSON.stringify({
                ...cipherCreateBody(),
                folderId: null,
                name: '2.trashed-encrypted-cipher-name',
              }),
              revisionDate: '2026-07-06T00:06:00.000Z',
              createdAt: '2026-07-06T00:04:30.000Z',
              deletedAt: '2026-07-06T00:06:00.000Z',
            },
          ],
          attachments: [attachmentRecord()],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      profile: Record<string, unknown>
      ciphers: Array<{ attachments?: unknown[] }>
    }
    expect(body).toMatchObject({
      ciphers: [
        {
          object: 'cipher',
          id: 'cipher-id',
          organizationId: null,
          folderId: 'folder-id',
          type: 1,
          favorite: true,
          name: '2.encrypted-cipher-name',
          revisionDate: '2026-07-06T00:05:00.000Z',
          creationDate: '2026-07-06T00:04:00.000Z',
          deletedDate: null,
          attachments: [
            {
              id: 'attachment-id',
              url: '/api/ciphers/cipher-id/attachment/attachment-id',
              fileName: '2.encrypted-file-name',
              key: '2.encrypted-attachment-key',
              size: '15',
              sizeName: '15 B',
            },
          ],
        },
        {
          object: 'cipher',
          id: 'trashed-cipher-id',
          organizationId: null,
          folderId: null,
          type: 1,
          favorite: false,
          name: '2.trashed-encrypted-cipher-name',
          revisionDate: '2026-07-06T00:06:00.000Z',
          creationDate: '2026-07-06T00:04:30.000Z',
          deletedDate: '2026-07-06T00:06:00.000Z',
        },
      ],
    })
    expectOfficialAttachmentFieldTypes(body.ciphers[0]?.attachments?.[0])
    expect(typeof body.profile.storage).toBe('number')
    expect(typeof body.profile.maxStorageGb).toBe('number')
  })

  it('keeps pending attachment allocations out of sync and storage usage', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/sync',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          ciphers: [cipherRecord()],
          attachments: [
            {
              ...attachmentRecord(),
              id: 'uploaded-attachment-id',
            },
            {
              ...pendingAttachmentRecord(),
              id: 'pending-attachment-id',
              objectKey: 'attachments/pending-object-id',
              size: 50,
            },
          ],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      profile: Record<string, unknown>
      ciphers: Array<{ attachments?: Array<{ id: string }> }>
    }
    expect(body.profile).toMatchObject({
      storage: 15,
      maxStorageGb: 1,
    })
    expect(body.ciphers[0]?.attachments).toEqual([
      expect.objectContaining({ id: 'uploaded-attachment-id' }),
    ])
    expect(JSON.stringify(body.ciphers)).not.toContain('pending-attachment-id')
  })

  it('keeps sync folders and ciphers isolated between personal vault users', async () => {
    const alice = {
      ...authUserRecord(),
      id: 'alice-id',
      email: 'Alice@Example.Test',
      emailNormalized: 'alice@example.test',
      displayName: 'Alice',
      userKey: '2.alice-user-key',
      securityStamp: 'alice-security-stamp',
    }
    const bob = {
      ...authUserRecord(),
      id: 'bob-id',
      email: 'Bob@Example.Test',
      emailNormalized: 'bob@example.test',
      displayName: 'Bob',
      userKey: '2.bob-user-key',
      securityStamp: 'bob-security-stamp',
    }
    const databaseOptions = {
      authUsers: [alice, bob],
      folders: [
        {
          id: 'alice-folder-id',
          userId: 'alice-id',
          name: '2.alice-encrypted-folder',
          revisionDate: '2026-07-06T00:03:00.000Z',
        },
        {
          id: 'bob-folder-id',
          userId: 'bob-id',
          name: '2.bob-encrypted-folder',
          revisionDate: '2026-07-06T00:04:00.000Z',
        },
      ],
      ciphers: [
        {
          id: 'alice-cipher-id',
          userId: 'alice-id',
          folderId: 'alice-folder-id',
          type: 1,
          favorite: 1,
          encryptedJson: JSON.stringify({
            ...cipherCreateBody(),
            folderId: 'alice-folder-id',
            name: '2.alice-encrypted-cipher',
          }),
          revisionDate: '2026-07-06T00:05:00.000Z',
          createdAt: '2026-07-06T00:04:00.000Z',
        },
        {
          id: 'bob-cipher-id',
          userId: 'bob-id',
          folderId: 'bob-folder-id',
          type: 1,
          favorite: 0,
          encryptedJson: JSON.stringify({
            ...cipherCreateBody(),
            folderId: 'bob-folder-id',
            name: '2.bob-encrypted-cipher',
          }),
          revisionDate: '2026-07-06T00:06:00.000Z',
          createdAt: '2026-07-06T00:04:00.000Z',
        },
      ],
    }

    const aliceResponse = await app.request(
      '/api/sync',
      {
        headers: {
          Authorization: `Bearer ${await accessTokenFor(alice)}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], databaseOptions),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )
    const bobResponse = await app.request(
      '/api/sync',
      {
        headers: {
          Authorization: `Bearer ${await accessTokenFor(bob)}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], databaseOptions),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(aliceResponse.status).toBe(200)
    expect(bobResponse.status).toBe(200)
    const aliceBody = (await aliceResponse.json()) as {
      folders: Array<{ id: string; name: string }>
      ciphers: Array<{ folderId: string; id: string; name: string }>
    }
    const bobBody = (await bobResponse.json()) as {
      folders: Array<{ id: string; name: string }>
      ciphers: Array<{ folderId: string; id: string; name: string }>
    }

    expect(aliceBody.folders).toHaveLength(1)
    expect(aliceBody.ciphers).toHaveLength(1)
    expect(aliceBody).toMatchObject({
      profile: {
        id: 'alice-id',
        email: 'alice@example.test',
      },
      folders: [
        {
          id: 'alice-folder-id',
          name: '2.alice-encrypted-folder',
        },
      ],
      ciphers: [
        {
          id: 'alice-cipher-id',
          folderId: 'alice-folder-id',
          name: '2.alice-encrypted-cipher',
        },
      ],
    })
    expect(JSON.stringify(aliceBody)).not.toContain('bob-')
    expect(bobBody.folders).toHaveLength(1)
    expect(bobBody.ciphers).toHaveLength(1)
    expect(bobBody).toMatchObject({
      profile: {
        id: 'bob-id',
        email: 'bob@example.test',
      },
      folders: [
        {
          id: 'bob-folder-id',
          name: '2.bob-encrypted-folder',
        },
      ],
      ciphers: [
        {
          id: 'bob-cipher-id',
          folderId: 'bob-folder-id',
          name: '2.bob-encrypted-cipher',
        },
      ],
    })
    expect(JSON.stringify(bobBody)).not.toContain('alice-')
  })

  it('syncs 50 active ciphers while preserving favorites and unknown encrypted fields', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const ciphers = Array.from({ length: 50 }, (_, index) => {
      const ordinal = index + 1
      const favorite = ordinal % 2 === 0

      return {
        id: `cipher-${ordinal}`,
        userId: 'user-id',
        folderId: ordinal % 3 === 0 ? 'folder-id' : null,
        type: ordinal % 5 === 0 ? 2 : 1,
        favorite: favorite ? 1 : 0,
        encryptedJson: JSON.stringify({
          type: ordinal % 5 === 0 ? 2 : 1,
          favorite,
          name: `2.encrypted-cipher-${ordinal}`,
          notes: `2.encrypted-notes-${ordinal}`,
          login:
            ordinal % 5 === 0
              ? undefined
              : {
                  username: `2.encrypted-username-${ordinal}`,
                  password: `2.encrypted-password-${ordinal}`,
                },
          secureNote:
            ordinal % 5 === 0
              ? {
                  type: 0,
                }
              : undefined,
          unknownEncryptedEnvelope: {
            value: `2.encrypted-future-${ordinal}`,
          },
        }),
        revisionDate: `2026-07-06T00:${String(ordinal).padStart(2, '0')}:00.000Z`,
        createdAt: '2026-07-06T00:00:00.000Z',
      }
    })
    const response = await app.request(
      '/api/sync',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          ciphers,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      ciphers: Array<Record<string, unknown>>
    }
    expect(body.ciphers).toHaveLength(50)
    expect(body.ciphers[0]).toMatchObject({
      object: 'cipher',
      id: 'cipher-1',
      type: 1,
      favorite: false,
      name: '2.encrypted-cipher-1',
      unknownEncryptedEnvelope: {
        value: '2.encrypted-future-1',
      },
    })
    expect(body.ciphers[1]).toMatchObject({
      id: 'cipher-2',
      favorite: true,
    })
    expect(body.ciphers[4]).toMatchObject({
      id: 'cipher-5',
      type: 2,
      secureNote: {
        type: 0,
      },
      unknownEncryptedEnvelope: {
        value: '2.encrypted-future-5',
      },
    })
    expect(body.ciphers[49]).toMatchObject({
      id: 'cipher-50',
      favorite: true,
      unknownEncryptedEnvelope: {
        value: '2.encrypted-future-50',
      },
    })
  })

  it('rejects malformed cipher create requests', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/ciphers',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'cipher-invalid-body-request',
        },
        body: JSON.stringify({
          favorite: true,
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
      },
      requestId: 'cipher-invalid-body-request',
    })
  })

  it('rejects cipher create when folder does not belong to the user', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/ciphers',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(cipherCreateBody()),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          folder: null,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'cipher_folder_not_found',
      },
    })
  })

  it('bulk-moves only owned ciphers to a folder and back to no folder', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const ownedOne = {
      ...cipherRecord(),
      id: '11111111-1111-4111-8111-111111111111',
    }
    const ownedTwo = {
      ...cipherRecord(),
      id: '22222222-2222-4222-8222-222222222222',
    }
    const unowned = {
      ...cipherRecord(),
      id: '33333333-3333-4333-8333-333333333333',
      userId: 'other-user-id',
      folderId: 'other-folder-id',
    }
    const ciphers = [ownedOne, ownedTwo, unowned]
    const database = new FakeD1Database(null, [], {
      authUser: user,
      ciphers,
      folders: [
        {
          id: 'target-folder-id',
          userId: user.id,
          name: '2.encrypted-target-folder',
          revisionDate: '2026-07-06T00:03:00.000Z',
        },
      ],
    })
    const env = {
      DB: database,
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
    }

    const moveResponse = await app.request(
      '/api/ciphers/move',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ids: [ownedOne.id, ownedTwo.id, unowned.id, 'missing-cipher-id'],
          folderId: 'target-folder-id',
        }),
      },
      env,
    )

    expect(moveResponse.status).toBe(200)
    expect(ownedOne.folderId).toBe('target-folder-id')
    expect(ownedTwo.folderId).toBe('target-folder-id')
    expect(unowned).toMatchObject({
      folderId: 'other-folder-id',
      revisionDate: '2026-07-06T00:05:00.000Z',
    })

    const removeResponse = await app.request(
      '/api/ciphers/move',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ids: [ownedOne.id, ownedTwo.id],
          folderId: null,
          organizationId: null,
        }),
      },
      env,
    )

    expect(removeResponse.status).toBe(200)
    expect(ownedOne.folderId).toBeNull()
    expect(ownedTwo.folderId).toBeNull()

    const singleUpdateResponse = await app.request(
      `/api/ciphers/${ownedOne.id}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...cipherCreateBody(),
          folderId: null,
          revisionDate: ownedOne.revisionDate,
          name: '2.single-update-after-bulk-routing',
        }),
      },
      env,
    )

    expect(singleUpdateResponse.status).toBe(200)
    await expect(singleUpdateResponse.json()).resolves.toMatchObject({
      object: 'cipher',
      id: ownedOne.id,
      name: '2.single-update-after-bulk-routing',
    })
  })

  it('bulk-trashes only active ciphers owned by the authenticated user', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const activeOwned = { ...cipherRecord(), id: 'active-owned-cipher' }
    const alreadyTrashed = {
      ...cipherRecord(),
      id: 'already-trashed-cipher',
      deletedAt: '2026-07-06T00:06:00.000Z',
      revisionDate: '2026-07-06T00:06:00.000Z',
    }
    const unowned = {
      ...cipherRecord(),
      id: 'unowned-active-cipher',
      userId: 'other-user-id',
    }
    const unownedBefore = { ...unowned }

    const response = await app.request(
      '/api/ciphers/delete',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ids: [
            activeOwned.id,
            alreadyTrashed.id,
            unowned.id,
            'missing-cipher-id',
          ],
          organizationId: null,
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          ciphers: [activeOwned, alreadyTrashed, unowned],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    expect(activeOwned.deletedAt).toEqual(expect.any(String))
    expect(activeOwned.revisionDate).toBe(activeOwned.deletedAt)
    expect(alreadyTrashed.deletedAt).toBe('2026-07-06T00:06:00.000Z')
    expect(unowned).toEqual(unownedBefore)
  })

  it('bulk-restores owned trashed ciphers and returns the official list response', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const trashedOne = {
      ...cipherRecord(),
      id: 'trashed-owned-one',
      deletedAt: '2026-07-06T00:06:00.000Z',
    }
    const trashedTwo = {
      ...cipherRecord(),
      id: 'trashed-owned-two',
      deletedAt: '2026-07-06T00:07:00.000Z',
    }
    const activeOwned = { ...cipherRecord(), id: 'active-owned-cipher' }
    const unowned = {
      ...cipherRecord(),
      id: 'trashed-unowned-cipher',
      userId: 'other-user-id',
      deletedAt: '2026-07-06T00:08:00.000Z',
    }

    const response = await app.request(
      '/api/ciphers/restore',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ids: [
            trashedOne.id,
            trashedTwo.id,
            activeOwned.id,
            unowned.id,
            'missing-cipher-id',
          ],
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          ciphers: [trashedOne, trashedTwo, activeOwned, unowned],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      object: string
      data: Array<Record<string, unknown>>
      continuationToken: string | null
    }
    expect(body.object).toBe('list')
    expect(body.continuationToken).toBeNull()
    expect(body.data.map((cipher) => cipher.id).sort()).toEqual(
      [trashedOne.id, trashedTwo.id].sort(),
    )
    expect(body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          object: 'cipher',
          id: trashedOne.id,
          deletedDate: null,
          revisionDate: expect.any(String),
        }),
        expect.objectContaining({
          object: 'cipher',
          id: trashedTwo.id,
          deletedDate: null,
          revisionDate: expect.any(String),
        }),
      ]),
    )
    expect(trashedOne.deletedAt).toBeNull()
    expect(trashedTwo.deletedAt).toBeNull()
    expect(unowned.deletedAt).toBe('2026-07-06T00:08:00.000Z')
  })

  it('bulk-permanently deletes owned ciphers and only their R2 attachments', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const activeOwned = { ...cipherRecord(), id: 'active-owned-cipher' }
    const trashedOwned = {
      ...cipherRecord(),
      id: 'trashed-owned-cipher',
      deletedAt: '2026-07-06T00:06:00.000Z',
    }
    const unowned = {
      ...cipherRecord(),
      id: 'unowned-cipher',
      userId: 'other-user-id',
    }
    const ciphers = [activeOwned, trashedOwned, unowned]
    const uploadedAttachment = {
      ...attachmentRecord(),
      id: 'owned-uploaded-attachment',
      cipherId: activeOwned.id,
      objectKey: 'attachments/owned-uploaded-object',
    }
    const pendingAttachment = {
      ...pendingAttachmentRecord(),
      id: 'owned-pending-attachment',
      cipherId: trashedOwned.id,
      objectKey: 'attachments/owned-pending-object',
    }
    const unownedAttachment = {
      ...attachmentRecord(),
      id: 'unowned-attachment',
      userId: 'other-user-id',
      cipherId: unowned.id,
      objectKey: 'attachments/unowned-object',
    }
    const attachments = [
      uploadedAttachment,
      pendingAttachment,
      unownedAttachment,
    ]
    const bucket = new FakeR2Bucket()
    for (const attachment of attachments) {
      await bucket.put(attachment.objectKey, attachment.id)
    }

    const response = await app.request(
      '/api/ciphers',
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ids: [
            activeOwned.id,
            trashedOwned.id,
            unowned.id,
            'missing-cipher-id',
          ],
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          attachments,
          authUser: user,
          ciphers,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        VAULT_OBJECTS: bucket as unknown as R2Bucket,
      },
    )

    expect(response.status).toBe(200)
    expect(ciphers).toEqual([unowned])
    expect(attachments).toEqual([unownedAttachment])
    expect(bucket.deletedKeys.sort()).toEqual(
      [uploadedAttachment.objectKey, pendingAttachment.objectKey].sort(),
    )
    expect(bucket.has(uploadedAttachment.objectKey)).toBe(false)
    expect(bucket.has(pendingAttachment.objectKey)).toBe(false)
    expect(bucket.has(unownedAttachment.objectKey)).toBe(true)
  })

  it('emits secret-safe aggregate audit events for bulk cipher mutations', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const ownedOne = {
      ...cipherRecord(),
      id: 'bulk-audit-owned-one',
      encryptedJson: JSON.stringify({
        name: '2.bulk-audit-secret-one',
        type: 1,
      }),
    }
    const ownedTwo = {
      ...cipherRecord(),
      id: 'bulk-audit-owned-two',
      encryptedJson: JSON.stringify({
        name: '2.bulk-audit-secret-two',
        type: 1,
      }),
    }
    const unowned = {
      ...cipherRecord(),
      id: 'bulk-audit-unowned',
      userId: 'other-user-id',
    }
    const attachment = {
      ...attachmentRecord(),
      id: 'bulk-audit-attachment',
      cipherId: ownedOne.id,
      objectKey: 'attachments/bulk-audit-object-key',
    }
    const database = new FakeD1Database(null, [], {
      attachments: [attachment],
      authUser: user,
      ciphers: [ownedOne, ownedTwo, unowned],
      folders: [
        {
          id: 'bulk-audit-folder',
          userId: user.id,
          name: '2.bulk-audit-folder-secret',
          revisionDate: '2026-07-06T00:03:00.000Z',
        },
      ],
    })
    const bucket = new FakeR2Bucket()
    await bucket.put(attachment.objectKey, 'bulk-audit-attachment-bytes')
    const env = {
      DB: database,
      HONOWARDEN_AUDIT_LOGS: 'true',
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      VAULT_OBJECTS: bucket as unknown as R2Bucket,
    }
    const ids = [ownedOne.id, ownedTwo.id, unowned.id, 'missing-cipher-id']

    const moveResponse = await app.request(
      '/api/ciphers/move',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'bulk-audit-move-request',
        },
        body: JSON.stringify({ ids, folderId: 'bulk-audit-folder' }),
      },
      env,
    )
    const trashResponse = await app.request(
      '/api/ciphers/delete',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'bulk-audit-delete-request',
        },
        body: JSON.stringify({ ids }),
      },
      env,
    )
    const restoreResponse = await app.request(
      '/api/ciphers/restore',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'bulk-audit-restore-request',
        },
        body: JSON.stringify({ ids }),
      },
      env,
    )
    const permanentDeleteResponse = await app.request(
      '/api/ciphers',
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'bulk-audit-permanent-delete-request',
        },
        body: JSON.stringify({ ids }),
      },
      env,
    )

    expect([
      moveResponse.status,
      trashResponse.status,
      restoreResponse.status,
      permanentDeleteResponse.status,
    ]).toEqual([200, 200, 200, 200])
    expect(database.auditEventInserts.map((event) => event.name)).toEqual([
      'cipher.update',
      'cipher.delete',
      'cipher.restore',
      'cipher.permanent_delete',
    ])
    expect(database.auditEventInserts).toEqual([
      expect.objectContaining({
        requestId: 'bulk-audit-move-request',
        targetType: 'cipher',
        targetId: null,
        contextJson: JSON.stringify({
          resultStatus: 'updated',
          operation: 'bulk_move',
          requestedCount: 4,
          affectedCount: 2,
          hasFolder: true,
        }),
      }),
      expect.objectContaining({
        requestId: 'bulk-audit-delete-request',
        targetType: 'cipher',
        targetId: null,
        contextJson: JSON.stringify({
          resultStatus: 'deleted',
          operation: 'bulk_delete',
          requestedCount: 4,
          affectedCount: 2,
        }),
      }),
      expect.objectContaining({
        requestId: 'bulk-audit-restore-request',
        targetType: 'cipher',
        targetId: null,
        contextJson: JSON.stringify({
          resultStatus: 'restored',
          operation: 'bulk_restore',
          requestedCount: 4,
          affectedCount: 2,
        }),
      }),
      expect.objectContaining({
        requestId: 'bulk-audit-permanent-delete-request',
        targetType: 'cipher',
        targetId: null,
        contextJson: JSON.stringify({
          resultStatus: 'permanently_deleted',
          operation: 'bulk_permanent_delete',
          requestedCount: 4,
          affectedCount: 2,
          attachmentCount: 1,
        }),
      }),
    ])
    const serialized = JSON.stringify(database.auditEventInserts)
    for (const secret of [
      ...ids,
      'bulk-audit-folder',
      attachment.objectKey,
      '2.bulk-audit-secret-one',
      '2.bulk-audit-secret-two',
      accessToken,
      'test-token-secret',
    ]) {
      expect(serialized).not.toContain(secret)
    }
  })

  it('treats empty and unknown bulk cipher ids as successful no-ops', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)

    for (const ids of [[], ['missing-cipher-id']]) {
      for (const { method, path, extraBody } of [
        {
          method: 'PUT',
          path: '/api/ciphers/move',
          extraBody: { folderId: null },
        },
        { method: 'PUT', path: '/api/ciphers/delete', extraBody: {} },
        { method: 'PUT', path: '/api/ciphers/restore', extraBody: {} },
        { method: 'DELETE', path: '/api/ciphers', extraBody: {} },
      ] as const) {
        const cipher = { ...cipherRecord() }
        const ciphers = [cipher]
        const bucket = new FakeR2Bucket()
        const response = await app.request(
          path,
          {
            method,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ids, ...extraBody }),
          },
          {
            DB: new FakeD1Database(null, [], {
              authUser: user,
              ciphers,
            }),
            HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
            VAULT_OBJECTS: bucket as unknown as R2Bucket,
          },
        )

        expect(response.status, `${method} ${path}`).toBe(200)
        expect(ciphers).toEqual([cipher])
        expect(bucket.deletedKeys).toEqual([])
        if (path === '/api/ciphers/restore') {
          await expect(response.json()).resolves.toEqual({
            object: 'list',
            data: [],
            continuationToken: null,
          })
        }
      }
    }
  })

  it('rejects malformed and oversized bulk cipher id lists without mutation', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const invalidIds = [
      'not-an-array',
      [''],
      [1],
      Array.from({ length: 1_001 }, (_, index) => `cipher-${index}`),
    ]

    for (const ids of invalidIds) {
      for (const { method, path, extraBody } of [
        {
          method: 'PUT',
          path: '/api/ciphers/move',
          extraBody: { folderId: null },
        },
        { method: 'PUT', path: '/api/ciphers/delete', extraBody: {} },
        { method: 'PUT', path: '/api/ciphers/restore', extraBody: {} },
        { method: 'DELETE', path: '/api/ciphers', extraBody: {} },
      ] as const) {
        const cipher = { ...cipherRecord() }
        const ciphers = [cipher]
        const response = await app.request(
          path,
          {
            method,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ids, ...extraBody }),
          },
          {
            DB: new FakeD1Database(null, [], {
              authUser: user,
              ciphers,
            }),
            HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
          },
        )

        expect(response.status, `${method} ${path}`).toBe(400)
        await expect(response.json()).resolves.toMatchObject({
          error: { code: 'invalid_request' },
        })
        expect(ciphers).toEqual([cipher])
      }
    }
  })

  it('accepts exactly 1000 ids on every bulk cipher route', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const ids = Array.from({ length: 1_000 }, (_, index) => `cipher-${index}`)

    for (const { method, path, extraBody } of [
      {
        method: 'PUT',
        path: '/api/ciphers/move',
        extraBody: { folderId: null },
      },
      { method: 'PUT', path: '/api/ciphers/delete', extraBody: {} },
      { method: 'PUT', path: '/api/ciphers/restore', extraBody: {} },
      { method: 'DELETE', path: '/api/ciphers', extraBody: {} },
    ] as const) {
      const response = await app.request(
        path,
        {
          method,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ids, ...extraBody }),
        },
        {
          DB: new FakeD1Database(null, [], {
            authUser: user,
            ciphers: [],
          }),
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
          VAULT_OBJECTS: new FakeR2Bucket() as unknown as R2Bucket,
        },
      )

      expect(response.status, `${method} ${path}`).toBe(200)
    }
  })

  it('requires bulk move folderId to be a non-empty string or null', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)

    for (const body of [
      { ids: ['cipher-id'] },
      { ids: ['cipher-id'], folderId: '' },
      { ids: ['cipher-id'], folderId: '   ' },
      { ids: ['cipher-id'], folderId: 42 },
    ]) {
      const response = await app.request(
        '/api/ciphers/move',
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
        {
          DB: new FakeD1Database(null, [], {
            authUser: user,
            ciphers: [{ ...cipherRecord() }],
          }),
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        },
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'invalid_request' },
      })
    }
  })

  it('rejects non-null organizations on every bulk cipher route', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)

    for (const { method, path, extraBody } of [
      {
        method: 'PUT',
        path: '/api/ciphers/move',
        extraBody: { folderId: null },
      },
      { method: 'PUT', path: '/api/ciphers/delete', extraBody: {} },
      { method: 'PUT', path: '/api/ciphers/restore', extraBody: {} },
      { method: 'DELETE', path: '/api/ciphers', extraBody: {} },
    ] as const) {
      const cipher = { ...cipherRecord() }
      const ciphers = [cipher]
      const response = await app.request(
        path,
        {
          method,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ids: [cipher.id],
            organizationId: 'unsupported-organization-id',
            ...extraBody,
          }),
        },
        {
          DB: new FakeD1Database(null, [], {
            authUser: user,
            ciphers,
          }),
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        },
      )

      expect(response.status, `${method} ${path}`).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'invalid_request' },
      })
      expect(ciphers).toEqual([cipher])
    }
  })

  it('rejects bulk moves to missing or unowned folders without mutation', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const cipher = { ...cipherRecord() }
    const ciphers = [cipher]
    const response = await app.request(
      '/api/ciphers/move',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ids: [cipher.id],
          folderId: 'unowned-folder-id',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          ciphers,
          folders: [
            {
              id: 'unowned-folder-id',
              userId: 'other-user-id',
              name: '2.encrypted-unowned-folder',
              revisionDate: '2026-07-06T00:03:00.000Z',
            },
          ],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'cipher_folder_not_found' },
    })
    expect(ciphers).toEqual([cipher])
  })

  it('updates a cipher for the authenticated user', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/ciphers/cipher-id',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...cipherCreateBody(),
          revisionDate: '2026-07-06T00:04:00.000Z',
          name: '2.updated-encrypted-cipher-name',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          cipher: {
            ...cipherRecord(),
            createdAt: '2026-07-06T00:04:00.000Z',
          },
          cipherUpdateChanges: 1,
          folder: {
            id: 'folder-id',
          },
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: 'cipher',
      id: 'cipher-id',
      folderId: 'folder-id',
      type: 1,
      favorite: true,
      name: '2.updated-encrypted-cipher-name',
      revisionDate: expect.any(String),
      creationDate: '2026-07-06T00:04:00.000Z',
      deletedDate: null,
    })
  })

  it('updates a cipher while preserving unknown encrypted fields', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/ciphers/cipher-id',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...cipherCreateBody(),
          folderId: null,
          revisionDate: '2026-07-06T00:04:00.000Z',
          name: '2.updated-encrypted-cipher-name',
          futureEncryptedShape: {
            value: '2.updated-encrypted-future-field',
          },
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          cipher: cipherRecord(),
          cipherUpdateChanges: 1,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: 'cipher',
      id: 'cipher-id',
      folderId: null,
      name: '2.updated-encrypted-cipher-name',
      futureEncryptedShape: {
        value: '2.updated-encrypted-future-field',
      },
      deletedDate: null,
    })
  })

  it('accepts the live CLI revision alias when updating a cipher', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/ciphers/cipher-id',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...cipherCreateBody(),
          folderId: null,
          lastKnownRevisionDate: '2026-07-06T00:04:00.000Z',
          name: '2.updated-encrypted-cipher-name',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          cipher: cipherRecord(),
          cipherUpdateChanges: 1,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: 'cipher',
      id: 'cipher-id',
      folderId: null,
      name: '2.updated-encrypted-cipher-name',
      revisionDate: expect.any(String),
      deletedDate: null,
    })
  })

  it('rejects cipher update without a revision date', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/ciphers/cipher-id',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'cipher-update-missing-revision-request',
        },
        body: JSON.stringify({
          ...cipherCreateBody(),
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
      },
      requestId: 'cipher-update-missing-revision-request',
    })
  })

  it('rejects malformed cipher update requests', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/ciphers/cipher-id',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'cipher-update-invalid-body-request',
        },
        body: JSON.stringify({
          type: 999,
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
      },
      requestId: 'cipher-update-invalid-body-request',
    })
  })

  it('rejects cipher update when folder does not belong to the user', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/ciphers/cipher-id',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...cipherCreateBody(),
          revisionDate: '2026-07-06T00:04:00.000Z',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          folder: null,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'cipher_folder_not_found',
      },
    })
  })

  it('returns not found when updating a missing, deleted, or cross-user cipher', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/ciphers/cipher-id',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...cipherCreateBody(),
          folderId: null,
          revisionDate: '2026-07-06T00:04:00.000Z',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          cipherUpdateChanges: 0,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'cipher_not_found',
      },
    })
  })

  it('returns conflict when updating a stale cipher revision', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/ciphers/cipher-id',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'cipher-update-conflict-request',
        },
        body: JSON.stringify({
          ...cipherCreateBody(),
          folderId: null,
          revisionDate: '2026-07-06T00:04:00.000Z',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          cipher: {
            ...cipherRecord(),
            revisionDate: '2026-07-06T00:05:00.000Z',
          },
          cipherUpdateChanges: 0,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'revision_conflict',
      },
      requestId: 'cipher-update-conflict-request',
    })
  })

  it('trashes a cipher through the upstream PUT delete route', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/ciphers/cipher-id/delete',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          cipherPermanentDeleteChanges: 0,
          cipherSoftDeleteChanges: 1,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: 'cipher',
      id: 'cipher-id',
      revisionDate: expect.any(String),
      deletedDate: expect.any(String),
    })
  })

  it('permanently deletes a trashed cipher through the upstream DELETE route', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/ciphers/cipher-id',
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          cipher: {
            ...cipherRecord(),
            deletedAt: '2026-07-06T00:06:00.000Z',
          },
          cipherPermanentDeleteChanges: 1,
          cipherSoftDeleteChanges: 0,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      object: 'cipherDeletion',
      id: 'cipher-id',
      revisionDate: expect.any(String),
    })
    expect(body).not.toHaveProperty('deletedDate')
  })

  it('deletes uploaded attachment R2 objects when permanently deleting a cipher', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const cipher = {
      ...cipherRecord(),
      deletedAt: '2026-07-06T00:06:00.000Z',
    }
    const attachment = attachmentRecord()
    const ciphers = [cipher]
    const attachments = [attachment]
    const bucket = new FakeR2Bucket()
    await bucket.put(attachment.objectKey, 'encrypted-bytes')

    const response = await app.request(
      `/api/ciphers/${cipher.id}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          attachments,
          authUser: user,
          ciphers,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        VAULT_OBJECTS: bucket as unknown as R2Bucket,
      },
    )

    expect(response.status).toBe(200)
    expect(bucket.has(attachment.objectKey)).toBe(false)
    expect(bucket.deletedKeys).toEqual([attachment.objectKey])
  })

  it('does not delete foreign cipher R2 objects on owned or forbidden permanent deletes', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const ownedCipher = cipherRecord()
    const foreignCipher = {
      ...cipherRecord(),
      id: 'foreign-cipher-id',
      userId: 'foreign-user-id',
    }
    const ownedAttachment = attachmentRecord()
    const foreignAttachment = {
      ...attachmentRecord(),
      id: 'foreign-attachment-id',
      userId: foreignCipher.userId,
      cipherId: foreignCipher.id,
      objectKey: 'attachments/foreign-object-id',
    }
    const ciphers = [ownedCipher, foreignCipher]
    const attachments = [ownedAttachment, foreignAttachment]
    const bucket = new FakeR2Bucket()
    await bucket.put(ownedAttachment.objectKey, 'owned-encrypted-bytes')
    await bucket.put(foreignAttachment.objectKey, 'foreign-encrypted-bytes')
    const env = {
      DB: new FakeD1Database(null, [], {
        attachments,
        authUser: user,
        ciphers,
      }),
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      VAULT_OBJECTS: bucket as unknown as R2Bucket,
    }

    const ownedDeleteResponse = await app.request(
      `/api/ciphers/${ownedCipher.id}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      env,
    )

    expect(ownedDeleteResponse.status).toBe(200)
    expect(bucket.has(ownedAttachment.objectKey)).toBe(false)
    expect(bucket.has(foreignAttachment.objectKey)).toBe(true)
    expect(ciphers).toEqual([foreignCipher])
    expect(attachments).toEqual([foreignAttachment])

    const foreignDeleteResponse = await app.request(
      `/api/ciphers/${foreignCipher.id}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'foreign-cipher-delete-request',
        },
      },
      env,
    )

    expect(foreignDeleteResponse.status).toBe(404)
    await expect(foreignDeleteResponse.json()).resolves.toEqual({
      error: {
        code: 'cipher_not_found',
        message: 'Cipher was not found.',
      },
      requestId: 'foreign-cipher-delete-request',
    })
    expect(bucket.deletedKeys).toEqual([ownedAttachment.objectKey])
    expect(bucket.has(foreignAttachment.objectKey)).toBe(true)
    expect(ciphers).toEqual([foreignCipher])
    expect(attachments).toEqual([foreignAttachment])
  })

  it('permanently deletes a non-trashed cipher through the upstream DELETE route', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/ciphers/cipher-id',
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          cipher: cipherRecord(),
          cipherPermanentDeleteChanges: 1,
          cipherSoftDeleteChanges: 1,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: 'cipherDeletion',
      id: 'cipher-id',
      revisionDate: expect.any(String),
    })
  })

  it('deletes pending attachment R2 objects through the upstream POST delete alias', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const cipher = cipherRecord()
    const attachment = pendingAttachmentRecord()
    const ciphers = [cipher]
    const attachments = [attachment]
    const bucket = new FakeR2Bucket()
    await bucket.put(attachment.objectKey, 'pending-encrypted-bytes')
    const response = await app.request(
      `/api/ciphers/${cipher.id}/delete`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          attachments,
          authUser: user,
          ciphers,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        VAULT_OBJECTS: bucket as unknown as R2Bucket,
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: 'cipherDeletion',
      id: 'cipher-id',
      revisionDate: expect.any(String),
    })
    expect(bucket.has(attachment.objectKey)).toBe(false)
    expect(bucket.deletedKeys).toEqual([attachment.objectKey])
  })

  it('restores a trashed cipher for the authenticated user', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/ciphers/cipher-id/restore',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          cipherRestoreChanges: 1,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: 'cipher',
      id: 'cipher-id',
      revisionDate: expect.any(String),
      deletedDate: null,
    })
  })

  it('retains DELETE /api/ciphers/:id/delete with attachment R2 cleanup', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const cipher = cipherRecord()
    const attachment = attachmentRecord()
    const ciphers = [cipher]
    const attachments = [attachment]
    const bucket = new FakeR2Bucket()
    await bucket.put(attachment.objectKey, 'encrypted-bytes')
    const response = await app.request(
      `/api/ciphers/${cipher.id}/delete`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          attachments,
          authUser: user,
          ciphers,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        VAULT_OBJECTS: bucket as unknown as R2Bucket,
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: 'cipherDeletion',
      id: 'cipher-id',
      revisionDate: expect.any(String),
    })
    expect(bucket.has(attachment.objectKey)).toBe(false)
    expect(bucket.deletedKeys).toEqual([attachment.objectKey])
  })

  it('emits secret-safe audit events for cipher mutations', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const database = new FakeD1Database(null, [], {
      authUser: user,
      cipher: {
        ...cipherRecord(),
        createdAt: '2026-07-06T00:04:00.000Z',
      },
      cipherPermanentDeleteChanges: 1,
      cipherRestoreChanges: 1,
      cipherSoftDeleteChanges: 1,
      cipherUpdateChanges: 1,
      folder: {
        id: 'folder-id',
      },
    })
    const env = {
      DB: database,
      HONOWARDEN_AUDIT_LOGS: 'true',
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
    }

    const createResponse = await app.request(
      '/api/ciphers',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'audit-cipher-create-request',
        },
        body: JSON.stringify(cipherCreateBody()),
      },
      env,
    )
    const updateResponse = await app.request(
      '/api/ciphers/cipher-id',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'audit-cipher-update-request',
        },
        body: JSON.stringify({
          ...cipherCreateBody(),
          revisionDate: '2026-07-06T00:04:00.000Z',
          name: '2.updated-encrypted-cipher-name',
        }),
      },
      env,
    )
    const trashResponse = await app.request(
      '/api/ciphers/cipher-id/delete',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'audit-cipher-delete-request',
        },
      },
      env,
    )
    const restoreResponse = await app.request(
      '/api/ciphers/cipher-id/restore',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'audit-cipher-restore-request',
        },
      },
      env,
    )
    const permanentDeleteResponse = await app.request(
      '/api/ciphers/cipher-id',
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Request-Id': 'audit-cipher-permanent-delete-request',
        },
      },
      env,
    )

    expect(createResponse.status).toBe(201)
    expect(updateResponse.status).toBe(200)
    expect(trashResponse.status).toBe(200)
    expect(restoreResponse.status).toBe(200)
    expect(permanentDeleteResponse.status).toBe(200)
    expect(database.auditEventInserts.map((event) => event.name)).toEqual([
      'cipher.create',
      'cipher.update',
      'cipher.delete',
      'cipher.restore',
      'cipher.permanent_delete',
    ])
    expect(database.auditEventInserts).toEqual([
      expect.objectContaining({
        outcome: 'success',
        requestId: 'audit-cipher-create-request',
        actorUserId: 'user-id',
        actorDeviceIdentifier: 'fixture-device',
        targetType: 'cipher',
        contextJson: JSON.stringify({
          resultStatus: 'created',
          cipherType: 1,
          favorite: true,
          hasFolder: true,
        }),
      }),
      expect.objectContaining({
        outcome: 'success',
        requestId: 'audit-cipher-update-request',
        actorUserId: 'user-id',
        actorDeviceIdentifier: 'fixture-device',
        targetType: 'cipher',
        targetId: 'cipher-id',
        contextJson: JSON.stringify({
          resultStatus: 'updated',
          cipherType: 1,
          favorite: true,
          hasFolder: true,
        }),
      }),
      expect.objectContaining({
        outcome: 'success',
        requestId: 'audit-cipher-delete-request',
        actorUserId: 'user-id',
        actorDeviceIdentifier: 'fixture-device',
        targetType: 'cipher',
        targetId: 'cipher-id',
        contextJson: JSON.stringify({ resultStatus: 'deleted' }),
      }),
      expect.objectContaining({
        outcome: 'success',
        requestId: 'audit-cipher-restore-request',
        actorUserId: 'user-id',
        actorDeviceIdentifier: 'fixture-device',
        targetType: 'cipher',
        targetId: 'cipher-id',
        contextJson: JSON.stringify({ resultStatus: 'restored' }),
      }),
      expect.objectContaining({
        outcome: 'success',
        requestId: 'audit-cipher-permanent-delete-request',
        actorUserId: 'user-id',
        actorDeviceIdentifier: 'fixture-device',
        targetType: 'cipher',
        targetId: 'cipher-id',
        contextJson: JSON.stringify({ resultStatus: 'permanently_deleted' }),
      }),
    ])
    const serialized = JSON.stringify(database.auditEventInserts)
    expect(serialized).not.toContain('2.encrypted-cipher-name')
    expect(serialized).not.toContain('2.updated-encrypted-cipher-name')
    expect(serialized).not.toContain('2.encrypted-password')
    expect(serialized).not.toContain('2.encrypted-username')
    expect(serialized).not.toContain(accessToken)
    expect(serialized).not.toContain('test-token-secret')
  })

  it('returns the same opaque not found response for missing or unowned cipher lifecycle mutations', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)

    for (const [method, path, options] of [
      ['PUT', '/api/ciphers/cipher-id/delete', { cipherSoftDeleteChanges: 0 }],
      ['DELETE', '/api/ciphers/cipher-id', { cipherPermanentDeleteChanges: 0 }],
      [
        'POST',
        '/api/ciphers/cipher-id/delete',
        { cipherPermanentDeleteChanges: 0 },
      ],
      ['PUT', '/api/ciphers/cipher-id/restore', { cipherRestoreChanges: 0 }],
      [
        'DELETE',
        '/api/ciphers/cipher-id/delete',
        { cipherPermanentDeleteChanges: 0 },
      ],
    ] as const) {
      const response = await app.request(
        path,
        {
          method,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-Request-Id': 'cipher-lifecycle-not-found-request',
          },
        },
        {
          DB: new FakeD1Database(null, [], {
            authUser: user,
            ...options,
          }),
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        },
      )

      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toEqual({
        error: {
          code: 'cipher_not_found',
          message: 'Cipher was not found.',
        },
        requestId: 'cipher-lifecycle-not-found-request',
      })
    }
  })

  it('rejects unauthenticated cipher lifecycle mutations', async () => {
    for (const [method, path] of [
      ['PUT', '/api/ciphers/cipher-id/delete'],
      ['DELETE', '/api/ciphers/cipher-id'],
      ['POST', '/api/ciphers/cipher-id/delete'],
      ['DELETE', '/api/ciphers/cipher-id/delete'],
      ['PUT', '/api/ciphers/cipher-id/restore'],
    ] as const) {
      const response = await app.request(
        path,
        {
          method,
          headers: {
            'X-Request-Id': 'cipher-lifecycle-missing-token-request',
          },
        },
        {
          DB: new FakeD1Database(null, []),
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
        },
      )

      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: 'missing_token',
        },
        requestId: 'cipher-lifecycle-missing-token-request',
      })
    }
  })

  it('returns a minimal upstream-compatible server config', async () => {
    const response = await app.request('https://vault.example.test/api/config')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      version: '0.1.0-alpha',
      server: null,
      environment: {
        cloudRegion: 'self-hosted',
        vault: 'https://vault.example.test',
        api: 'https://vault.example.test/api',
        identity: 'https://vault.example.test/identity',
        notifications: 'https://vault.example.test/notifications',
      },
      settings: {
        disableUserRegistration: true,
      },
      object: 'config',
    })
  })

  it('rejects notification hub requests that are not websocket upgrades', async () => {
    const response = await app.request(
      'https://vault.example.test/notifications/hub',
      {
        headers: {
          Authorization: 'Bearer opaque-access-token',
          'X-Request-Id': 'notification-hub-non-upgrade',
        },
      },
      {
        DB: new FakeD1Database(null, []),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(426)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'websocket_required',
        message: 'Notification hub requires a WebSocket upgrade.',
      },
      requestId: 'notification-hub-non-upgrade',
    })
  })

  it('requires an access token for notification websocket upgrades', async () => {
    const response = await app.request(
      'https://vault.example.test/notifications/hub',
      {
        headers: {
          Upgrade: 'websocket',
          'X-Request-Id': 'notification-hub-missing-token',
        },
      },
      {
        DB: new FakeD1Database(null, []),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'missing_token',
        message: 'Bearer authorization is required.',
      },
      requestId: 'notification-hub-missing-token',
    })
  })

  it('proxies authenticated notification sockets with the authoritative credential generation', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const fetch = vi.fn().mockResolvedValue(new Response('connected'))
    const notificationHub = {
      idFromName: vi.fn((name: string) => `do:${name}`),
      get: vi.fn(() => ({ fetch })),
    }
    const response = await app.request(
      'https://vault.example.test/notifications/hub',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Upgrade: 'websocket',
          [notificationSecurityStampHeader]: 'client-controlled-value',
        },
      },
      {
        DB: new FakeD1Database(null, [], { authUser: user }),
        NOTIFICATION_HUB: notificationHub as unknown as DurableObjectNamespace,
        HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED: 'true',
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    expect(notificationHub.idFromName).toHaveBeenCalledWith(user.id)
    expect(fetch).toHaveBeenCalledOnce()
    const forwarded = fetch.mock.calls[0]?.[0] as Request
    expect(forwarded.url).toBe('https://notification-hub/connect')
    expect(forwarded.headers.get(notificationSecurityStampHeader)).toBe(
      user.securityStamp,
    )
    expect(forwarded.headers.get(notificationCredentialRevisionHeader)).toBe(
      user.revisionDate,
    )
  })

  it('rejects anonymous notification requests that are not websocket upgrades', async () => {
    const response = await app.request(
      'https://vault.example.test/notifications/anonymous-hub?Token=auth-request-id',
      {
        headers: {
          'X-Request-Id': 'anonymous-hub-non-upgrade',
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authRequests: [authRequestRecord()],
        }),
        HONOWARDEN_AUTH_REQUESTS_ENABLED: 'true',
        HONOWARDEN_AUTH_REQUEST_SECRET: '0123456789abcdef0123456789abcdef',
      },
    )

    expect(response.status).toBe(426)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'websocket_required' },
      requestId: 'anonymous-hub-non-upgrade',
    })
  })

  it('does not open anonymous notification sockets for unknown requests', async () => {
    const response = await app.request(
      'https://vault.example.test/notifications/anonymous-hub?Token=unknown-request',
      {
        headers: {
          Upgrade: 'websocket',
          'X-Request-Id': 'anonymous-hub-unknown-request',
        },
      },
      {
        DB: new FakeD1Database(null, [], { authRequests: [] }),
        NOTIFICATION_HUB: {} as DurableObjectNamespace,
        HONOWARDEN_AUTH_REQUESTS_ENABLED: 'true',
        HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED: 'true',
        HONOWARDEN_AUTH_REQUEST_SECRET: '0123456789abcdef0123456789abcdef',
      },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'auth_request_not_found' },
      requestId: 'anonymous-hub-unknown-request',
    })
  })

  it('proxies valid anonymous notification sockets to a request-scoped object', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('connected'))
    const notificationHub = {
      idFromName: vi.fn((name: string) => `do:${name}`),
      get: vi.fn(() => ({ fetch })),
    }
    const response = await app.request(
      'https://vault.example.test/notifications/anonymous-hub?Token=auth-request-id',
      {
        headers: { Upgrade: 'websocket' },
      },
      {
        DB: new FakeD1Database(null, [], {
          authRequests: [authRequestRecord()],
        }),
        NOTIFICATION_HUB: notificationHub as unknown as DurableObjectNamespace,
        HONOWARDEN_AUTH_REQUESTS_ENABLED: 'true',
        HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED: 'true',
        HONOWARDEN_AUTH_REQUEST_SECRET: '0123456789abcdef0123456789abcdef',
      },
    )

    expect(response.status).toBe(200)
    expect(notificationHub.idFromName).toHaveBeenCalledWith(
      'auth-request:auth-request-id',
    )
    expect(fetch).toHaveBeenCalledOnce()
    const forwarded = fetch.mock.calls[0]?.[0] as Request
    expect(forwarded.url).toBe('https://notification-hub/connect')
    expect(forwarded.headers.get('Upgrade')).toBe('websocket')
  })

  it('reports anonymous notification transport failures explicitly', async () => {
    const response = await app.request(
      'https://vault.example.test/notifications/anonymous-hub?Token=auth-request-id',
      { headers: { Upgrade: 'websocket' } },
      {
        DB: new FakeD1Database(null, [], {
          authRequests: [authRequestRecord()],
        }),
        NOTIFICATION_HUB: {
          idFromName: () => 'request-object',
          get: () => ({
            fetch: vi.fn().mockRejectedValue(new Error('do unavailable')),
          }),
        } as unknown as DurableObjectNamespace,
        HONOWARDEN_AUTH_REQUESTS_ENABLED: 'true',
        HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED: 'true',
        HONOWARDEN_AUTH_REQUEST_SECRET: '0123456789abcdef0123456789abcdef',
      },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'notification_unavailable' },
    })
  })

  it('rejects invalid SignalR access_token query authentication', async () => {
    const response = await app.request(
      'https://vault.example.test/notifications/hub?access_token=invalid',
      {
        headers: {
          Upgrade: 'websocket',
          'X-Request-Id': 'notification-hub-invalid-token',
        },
      },
      {
        DB: new FakeD1Database(null, []),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'invalid_token' },
      requestId: 'notification-hub-invalid-token',
    })
  })

  it('acknowledges JSON SignalR handshakes and stops heartbeat on close', () => {
    vi.useFakeTimers()
    const socket = new FakeWebSocket()

    acceptNotificationHubWebSocket(socket as unknown as WebSocket)
    socket.emitMessage('{"protocol":"json","version":1}\u001e')

    expect(socket.accepted).toBe(true)
    expect(socket.sent).toEqual(['{}\u001e', '{"type":6}\u001e'])

    vi.advanceTimersByTime(15_000)
    expect(socket.sent).toHaveLength(3)

    socket.emitClose()
    vi.advanceTimersByTime(30_000)
    expect(socket.sent).toHaveLength(3)
    vi.useRealTimers()
  })

  it('uses length-prefixed MessagePack pings and replaces duplicate heartbeat timers', () => {
    vi.useFakeTimers()
    const socket = new FakeWebSocket()

    acceptNotificationHubWebSocket(socket as unknown as WebSocket)
    socket.emitMessage('{"protocol":"messagepack","version":1}\u001e')
    socket.emitMessage('{"protocol":"messagepack","version":1}\u001e')

    expect(socket.sent).toHaveLength(4)
    expect(readBytes(socket.sent[1])).toEqual([0x02, 0x91, 0x06])
    expect(readBytes(socket.sent[3])).toEqual([0x02, 0x91, 0x06])

    vi.advanceTimersByTime(15_000)
    expect(socket.sent).toHaveLength(5)
    expect(readBytes(socket.sent[4])).toEqual([0x02, 0x91, 0x06])

    socket.emitError()
    vi.advanceTimersByTime(30_000)
    expect(socket.sent).toHaveLength(5)
    vi.useRealTimers()
  })

  it('keeps forwarded HTTPS origins in server config URLs', async () => {
    const response = await app.request('http://vault.example.test/api/config', {
      headers: {
        'X-Forwarded-Proto': 'https',
      },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      environment: {
        vault: 'https://vault.example.test',
        api: 'https://vault.example.test/api',
        identity: 'https://vault.example.test/identity',
        notifications: 'https://vault.example.test/notifications',
      },
    })
  })

  it('keeps Cloudflare visitor HTTPS origins in server config URLs', async () => {
    const response = await app.request('http://vault.example.test/api/config', {
      headers: {
        'CF-Visitor': JSON.stringify({ scheme: 'https' }),
      },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      environment: {
        vault: 'https://vault.example.test',
        api: 'https://vault.example.test/api',
        identity: 'https://vault.example.test/identity',
        notifications: 'https://vault.example.test/notifications',
      },
    })
  })

  it('returns structured JSON for unknown routes', async () => {
    const response = await app.request('/missing', {
      headers: {
        'X-Request-Id': 'missing-request',
      },
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'not_found',
        message: 'The requested resource was not found.',
      },
      requestId: 'missing-request',
    })
  })
})

function authUserRecord() {
  return {
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
  }
}

function masterPasswordChangeBody(user: ReturnType<typeof authUserRecord>) {
  const kdf = {
    kdfType: 0,
    iterations: user.kdfIterations,
    memory: user.kdfMemory,
    parallelism: user.kdfParallelism,
  }
  return {
    masterPasswordHash: user.masterPasswordHash,
    newMasterPasswordHash: 'synthetic-next-master-password-hash',
    key: '2.synthetic-next-user-key',
    masterPasswordHint: '',
    authenticationData: {
      kdf,
      masterPasswordAuthenticationHash: 'synthetic-next-master-password-hash',
      salt: user.emailNormalized,
    },
    unlockData: {
      kdf,
      masterKeyWrappedUserKey: '2.synthetic-next-user-key',
      salt: user.emailNormalized,
    },
  }
}

function kdfChangeBody(
  user: { emailNormalized: string; masterPasswordHash: string },
  overrides: {
    kdf?: {
      kdfType: number
      iterations: number
      memory: number | null
      parallelism: number | null
    }
    nextMasterPasswordHash?: string
    nextUserKey?: string
  } = {},
) {
  const kdf = overrides.kdf ?? {
    kdfType: 1,
    iterations: 6,
    memory: 32,
    parallelism: 4,
  }
  const nextMasterPasswordHash =
    overrides.nextMasterPasswordHash ?? 'synthetic-argon2-master-password-hash'
  const nextUserKey = overrides.nextUserKey ?? '2.synthetic-argon2-user-key'
  return {
    masterPasswordHash: user.masterPasswordHash,
    authenticationData: {
      kdf,
      masterPasswordAuthenticationHash: nextMasterPasswordHash,
      salt: user.emailNormalized,
    },
    unlockData: {
      kdf,
      masterKeyWrappedUserKey: nextUserKey,
      salt: user.emailNormalized,
    },
  }
}

function accountKeyInitializationBody() {
  return {
    publicKey: 'synthetic-initialized-public-key',
    encryptedPrivateKey: '2.synthetic-initialized-wrapped-private-key',
  }
}

function accountKeysEndpointResponse() {
  return {
    object: 'keys',
    key: '2.synthetic-user-key',
    publicKey: 'synthetic-initialized-public-key',
    privateKey: '2.synthetic-initialized-wrapped-private-key',
    accountKeys: {
      object: 'privateKeys',
      signatureKeyPair: null,
      publicKeyEncryptionKeyPair: {
        object: 'publicKeyEncryptionKeyPair',
        publicKey: 'synthetic-initialized-public-key',
        wrappedPrivateKey: '2.synthetic-initialized-wrapped-private-key',
        signedPublicKey: null,
      },
      securityState: null,
    },
  }
}

function passwordGrantRequest(
  database: FakeD1Database,
  passwordHash: string,
  deviceIdentifier: string,
) {
  return app.request(
    '/identity/connect/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        username: 'person@example.test',
        password: passwordHash,
        scope: 'api offline_access',
        deviceIdentifier,
        deviceName: 'Password Change Test',
        deviceType: '8',
      }),
    },
    {
      DB: database,
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
    },
  )
}

function refreshTokenSessionRecord() {
  return {
    tokenId: 'refresh-token-id',
    userId: 'user-id',
    deviceId: 'device-id',
    deviceIdentifier: 'fixture-device',
    tokenExpiresAt: '2999-08-05T00:00:00.000Z',
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
    totpEnabled: false,
    totpEncryptedSecret: null,
    totpLastAcceptedStep: null,
  }
}

function deviceRecord() {
  return {
    id: 'approver-device-id',
    userId: 'user-id',
    identifier: 'fixture-device',
    name: 'Approver',
    type: 8,
    encryptedUserKey: null,
    encryptedPublicKey: null,
    encryptedPrivateKey: null,
    lastSeenAt: null,
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
    revokedAt: null,
  }
}

function authRequestRecord() {
  return {
    id: 'auth-request-id',
    userId: 'user-id',
    emailHash: 'hmac-sha256:email-hash',
    requestType: 0,
    requestDeviceIdentifier: 'requester-device',
    requestDeviceType: 8,
    requestPublicKey: 'opaque-public-key',
    accessCodeHash: 'hmac-sha256:access-code-hash',
    status: 'pending',
    requestApproved: null,
    approvingDeviceIdentifier: null,
    encryptedResponseKey: null,
    createdAt: '2026-07-11T00:00:00.000Z',
    responseAt: null,
    consumedAt: null,
    expiresAt: '2999-07-11T00:15:00.000Z',
    retentionDeleteAfter: '2999-08-10T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
  }
}

function unblockedRequestQuotaBucket() {
  return {
    bucketKey: 'request:anonymous:auth-request-quota',
    scope: 'anonymous',
    requestCount: 1,
    windowStartedAt: '2026-07-11T00:00:00.000Z',
    blockedUntil: null,
    updatedAt: '2026-07-11T00:00:00.000Z',
  }
}

function cipherCreateBody() {
  return {
    type: 1,
    folderId: 'folder-id',
    favorite: true,
    name: '2.encrypted-cipher-name',
    notes: null,
    login: {
      username: '2.encrypted-username',
      password: '2.encrypted-password',
      uris: [],
    },
  }
}

function organizationCreateBody() {
  return {
    name: 'Example Organization',
    billingEmail: 'billing@example.test',
    planType: 0,
    key: ' 2.opaque-member-wrapped-org-key\n',
    keys: {
      publicKey: '\topaque-org-public-key ',
      encryptedPrivateKey: ' 2.opaque-org-private-key\n',
    },
    collectionName: '\t2.opaque-encrypted-default-collection ',
  }
}

function organizationResponseShape(input: {
  id: unknown
  name: string
  planType: number
}) {
  return {
    Object: 'organization',
    ...organizationFeatureShape(input),
  }
}

function organizationFeatureShape(input: {
  id: unknown
  name: string
  planType: number
}) {
  return {
    Id: input.id,
    Name: input.name,
    Enabled: true,
    UsePolicies: false,
    UseSso: false,
    UseKeyConnector: false,
    UseScim: false,
    UseGroups: false,
    UseEvents: false,
    UseDirectory: false,
    UseTotp: true,
    Use2fa: false,
    UseApi: false,
    UseResetPassword: false,
    UseSecretsManager: false,
    UsePasswordManager: true,
    SelfHost: false,
    Seats: 0,
    MaxCollections: null,
    MaxStorageGb: null,
    MaxSeats: null,
    MaxUsers: null,
    MaxServiceAccounts: null,
    PlanType: input.planType,
    ProviderId: null,
    ProviderName: null,
  }
}

function profileOrganizationShape(input: {
  id: string
  key: string
  name: string
  planType: number
}) {
  return {
    ...organizationFeatureShape(input),
    Key: input.key,
    Status: 2,
    Type: 0,
    Permissions: {},
  }
}

function collectionResponseShape(input: {
  id: unknown
  organizationId: string
  name: string
  externalId: string | null
}) {
  return {
    Object: 'collection',
    Id: input.id,
    OrganizationId: input.organizationId,
    Name: input.name,
    ExternalId: input.externalId,
    DefaultUserCollectionEmail: null,
    Type: 0,
  }
}

function collectionAccessDetailsShape(input: {
  id: unknown
  organizationId: string
  name: string
  externalId: string | null
  organizationUserId: string
}) {
  return {
    ...collectionResponseShape(input),
    Object: 'collectionAccessDetails',
    Assigned: true,
    ReadOnly: false,
    HidePasswords: false,
    Manage: true,
    Unmanaged: false,
    Groups: [],
    Users: [collectionUserSelectionShape(input.organizationUserId)],
  }
}

function collectionUserSelectionShape(id: string) {
  return {
    Id: id,
    ReadOnly: false,
    HidePasswords: false,
    Manage: true,
  }
}

function cipherRecord() {
  return {
    id: 'cipher-id',
    userId: 'user-id',
    folderId: null,
    type: 1,
    favorite: 0,
    encryptedJson: JSON.stringify(cipherCreateBody()),
    revisionDate: '2026-07-06T00:05:00.000Z',
    createdAt: '2026-07-06T00:04:00.000Z',
    deletedAt: null,
  }
}

function expectOfficialAttachmentFieldTypes(value: unknown) {
  const attachment = value as Record<string, unknown>

  for (const field of ['id', 'url', 'fileName', 'key', 'size', 'sizeName']) {
    expect(typeof attachment[field]).toBe('string')
  }
}

function attachmentRecord() {
  return {
    id: 'attachment-id',
    userId: 'user-id',
    cipherId: 'cipher-id',
    objectKey: 'attachments/opaque-object-id',
    fileName: '2.encrypted-file-name',
    attachmentKey: '2.encrypted-attachment-key',
    size: 15,
    contentType: 'application/octet-stream',
    uploadState: 'uploaded',
    pendingExpiresAt: null,
    revisionDate: '2026-07-10T00:00:00.000Z',
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
  }
}

function pendingAttachmentRecord() {
  return {
    ...attachmentRecord(),
    contentType: null,
    uploadState: 'pending',
    pendingExpiresAt: '2999-07-10T00:00:00.000Z',
    updatedAt: '2999-07-09T00:00:00.000Z',
  }
}

function buildDevicePathId(deviceIdentifier: string): string {
  return `user-id:${deviceIdentifier}`
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function decodeJwtHeader(token: string): Record<string, unknown> {
  const [encodedHeader] = token.split('.')
  expect(encodedHeader).toBeDefined()

  return JSON.parse(
    Buffer.from(encodedHeader ?? '', 'base64url').toString('utf8'),
  ) as Record<string, unknown>
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, encodedPayload] = token.split('.')
  expect(encodedPayload).toBeDefined()

  return JSON.parse(
    Buffer.from(encodedPayload ?? '', 'base64url').toString('utf8'),
  ) as Record<string, unknown>
}

function premiumFeatureBinding(value: string | undefined): {
  HONOWARDEN_PREMIUM_FEATURES_ENABLED?: string
} {
  return value === undefined
    ? {}
    : { HONOWARDEN_PREMIUM_FEATURES_ENABLED: value }
}

async function accessTokenFor(
  user: Pick<
    ReturnType<typeof authUserRecord>,
    'emailNormalized' | 'id' | 'securityStamp'
  >,
) {
  return signAccessToken('test-token-secret', {
    sub: user.id,
    email: user.emailNormalized,
    device: 'fixture-device',
    securityStamp: user.securityStamp,
    iat: 1,
    exp: 4_102_444_800,
  })
}

async function recentPasswordAccessTokenFor(
  user: Pick<
    ReturnType<typeof authUserRecord>,
    'emailNormalized' | 'id' | 'securityStamp'
  >,
) {
  const issuedAt = Math.floor(Date.now() / 1000)

  return signAccessToken('test-token-secret', {
    sub: user.id,
    email: user.emailNormalized,
    device: 'fixture-device',
    securityStamp: user.securityStamp,
    iat: issuedAt,
    exp: issuedAt + 3600,
    authMethod: 'password',
  })
}

async function stalePasswordAccessTokenFor(
  user: Pick<
    ReturnType<typeof authUserRecord>,
    'emailNormalized' | 'id' | 'securityStamp'
  >,
) {
  const issuedAt = Math.floor(Date.now() / 1000) - 600

  return signAccessToken('test-token-secret', {
    sub: user.id,
    email: user.emailNormalized,
    device: 'fixture-device',
    securityStamp: user.securityStamp,
    iat: issuedAt,
    exp: issuedAt + 3600,
    authMethod: 'password',
  })
}

async function refreshAccessTokenFor(
  user: Pick<
    ReturnType<typeof authUserRecord>,
    'emailNormalized' | 'id' | 'securityStamp'
  >,
) {
  const issuedAt = Math.floor(Date.now() / 1000)

  return signAccessToken('test-token-secret', {
    sub: user.id,
    email: user.emailNormalized,
    device: 'fixture-device',
    securityStamp: user.securityStamp,
    iat: issuedAt,
    exp: issuedAt + 3600,
    authMethod: 'refresh',
  })
}

async function currentTotpCode(secret: string): Promise<string> {
  return hotp(secret, Math.floor(Date.now() / 1000 / 30))
}
