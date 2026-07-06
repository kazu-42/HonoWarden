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
