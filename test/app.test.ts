import { afterEach, describe, expect, it, vi } from 'vitest'

import app from '../src/app'
import {
  buildAuthAttemptBucketKey,
  loginDefensePolicy,
} from '../src/domain/login-defense'
import { encryptTotpSecret } from '../src/domain/totp-secret'
import { signAccessToken, verifyAccessToken } from '../src/domain/tokens'
import { hotp } from '../src/domain/totp'
import { FakeD1Database, requiredTables } from './support/fake-d1'

describe('HonoWarden app', () => {
  afterEach(() => {
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
        HONOWARDEN_ALLOWED_EMAILS: 'person@example.test',
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('X-Request-Id')).toBe('prelogin-request')
    await expect(response.json()).resolves.toEqual({
      kdf: 0,
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
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
        HONOWARDEN_ALLOWED_EMAILS: 'person@example.test',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      kdf: 0,
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
    })
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
      { method: 'POST', path: '/api/organizations' },
      { method: 'POST', path: '/api/organizations/org-id/collections' },
      { method: 'POST', path: '/api/sends' },
      { method: 'POST', path: '/api/sends/send-id' },
      { method: 'POST', path: '/api/collections' },
      { method: 'POST', path: '/api/collections/collection-id' },
      { method: 'POST', path: '/api/emergency-access' },
      { method: 'POST', path: '/api/emergency-access/invite' },
      { method: 'POST', path: '/api/attachments' },
      { method: 'GET', path: '/api/attachments/attachment-id' },
      { method: 'POST', path: '/api/ciphers/cipher-id/attachment' },
      {
        method: 'DELETE',
        path: '/api/ciphers/cipher-id/attachment/attachment-id',
      },
      { method: 'PUT', path: '/api/devices/device-id' },
      { method: 'PATCH', path: '/api/devices/device-id/keys' },
      { method: 'PUT', path: '/api/devices/device-id/trust' },
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
      Kdf: 0,
      KdfIterations: 600000,
    })
    await expect(
      verifyAccessToken('test-token-secret', body.access_token),
    ).resolves.toMatchObject({
      ok: true,
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
    await expect(response.json()).resolves.toEqual({
      object: 'sync',
      Profile: {
        Id: 'user-id',
        Name: 'Person',
        Email: 'person@example.test',
        EmailVerified: true,
        Premium: false,
        PremiumFromOrganization: false,
        Culture: 'en-US',
        TwoFactorEnabled: false,
        Key: '2.synthetic-user-key',
        AccountKeys: {
          publicKeyEncryptionKeyPair: {
            publicKey: 'synthetic-public-key',
            wrappedPrivateKey: '2.synthetic-private-key',
          },
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
      },
      Folders: [],
      Collections: [],
      Ciphers: [],
      Domains: {
        EquivalentDomains: [],
        GlobalEquivalentDomains: [],
      },
      Policies: [],
      PoliciesNew: [],
      Sends: [],
      UserDecryption: {
        MasterPasswordUnlock: {
          Salt: 'person@example.test',
          Kdf: {
            KdfType: 0,
            Iterations: 600000,
          },
          MasterKeyEncryptedUserKey: '2.synthetic-user-key',
        },
      },
    })
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
      await expect(response.json()).resolves.toEqual({
        EquivalentDomains: [],
        GlobalEquivalentDomains: [],
      })
    }
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
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      object: 'profile',
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
        publicKeyEncryptionKeyPair: {
          publicKey: 'synthetic-public-key',
          wrappedPrivateKey: '2.synthetic-private-key',
        },
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
      Profile: {
        TwoFactorEnabled: true,
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
      Folders: [
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
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
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
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: 'cipher',
      id: 'cipher-id',
      organizationId: null,
      folderId: 'folder-id',
      type: 1,
      favorite: true,
      name: '2.encrypted-cipher-name',
      futureEncryptedShape: {
        value: '2.encrypted-future-field',
      },
      revisionDate: '2026-07-06T00:05:00.000Z',
      creationDate: '2026-07-06T00:04:00.000Z',
      deletedDate: null,
    })
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
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: 'cipher_not_found',
        },
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
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      Ciphers: [
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
      Folders: Array<{ id: string; name: string }>
      Ciphers: Array<{ folderId: string; id: string; name: string }>
    }
    const bobBody = (await bobResponse.json()) as {
      Folders: Array<{ id: string; name: string }>
      Ciphers: Array<{ folderId: string; id: string; name: string }>
    }

    expect(aliceBody.Folders).toHaveLength(1)
    expect(aliceBody.Ciphers).toHaveLength(1)
    expect(aliceBody).toMatchObject({
      Profile: {
        Id: 'alice-id',
        Email: 'alice@example.test',
      },
      Folders: [
        {
          id: 'alice-folder-id',
          name: '2.alice-encrypted-folder',
        },
      ],
      Ciphers: [
        {
          id: 'alice-cipher-id',
          folderId: 'alice-folder-id',
          name: '2.alice-encrypted-cipher',
        },
      ],
    })
    expect(JSON.stringify(aliceBody)).not.toContain('bob-')
    expect(bobBody.Folders).toHaveLength(1)
    expect(bobBody.Ciphers).toHaveLength(1)
    expect(bobBody).toMatchObject({
      Profile: {
        Id: 'bob-id',
        Email: 'bob@example.test',
      },
      Folders: [
        {
          id: 'bob-folder-id',
          name: '2.bob-encrypted-folder',
        },
      ],
      Ciphers: [
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
      Ciphers: Array<Record<string, unknown>>
    }
    expect(body.Ciphers).toHaveLength(50)
    expect(body.Ciphers[0]).toMatchObject({
      object: 'cipher',
      id: 'cipher-1',
      type: 1,
      favorite: false,
      name: '2.encrypted-cipher-1',
      unknownEncryptedEnvelope: {
        value: '2.encrypted-future-1',
      },
    })
    expect(body.Ciphers[1]).toMatchObject({
      id: 'cipher-2',
      favorite: true,
    })
    expect(body.Ciphers[4]).toMatchObject({
      id: 'cipher-5',
      type: 2,
      secureNote: {
        type: 0,
      },
      unknownEncryptedEnvelope: {
        value: '2.encrypted-future-5',
      },
    })
    expect(body.Ciphers[49]).toMatchObject({
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

  it('trashes a cipher for the authenticated user', async () => {
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

  it('permanently deletes a cipher for the authenticated user', async () => {
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
          cipherPermanentDeleteChanges: 1,
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

  it('returns not found for missing cipher lifecycle mutations', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)

    for (const [method, path, options] of [
      ['PUT', '/api/ciphers/cipher-id/delete', { cipherSoftDeleteChanges: 0 }],
      ['PUT', '/api/ciphers/cipher-id/restore', { cipherRestoreChanges: 0 }],
      ['DELETE', '/api/ciphers/cipher-id', { cipherPermanentDeleteChanges: 0 }],
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
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: 'cipher_not_found',
        },
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

function buildDevicePathId(deviceIdentifier: string): string {
  return `user-id:${deviceIdentifier}`
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
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
