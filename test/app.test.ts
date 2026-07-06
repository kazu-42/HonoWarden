import { describe, expect, it } from 'vitest'

import app from '../src/app'
import { FakeD1Database, requiredTables } from './support/fake-d1'

describe('HonoWarden app', () => {
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
      version: '0.0.0-alpha',
      requestId: 'health-request',
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
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      token_type: 'Bearer',
      expires_in: 3600,
      Key: '2.synthetic-user-key',
      PrivateKey: null,
      Kdf: 0,
      KdfIterations: 600000,
      KdfMemory: null,
      KdfParallelism: null,
      AccountKeys: null,
      ForcePasswordReset: false,
      TwoFactorToken: null,
      MasterPasswordPolicy: null,
      UserDecryptionOptions: null,
      KeyConnectorUrl: null,
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

  it('returns a minimal upstream-compatible server config', async () => {
    const response = await app.request('https://vault.example.test/api/config')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      version: '0.0.0-alpha',
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
    privateKey: null,
    securityStamp: 'security-stamp',
    disabledAt: null,
  }
}
