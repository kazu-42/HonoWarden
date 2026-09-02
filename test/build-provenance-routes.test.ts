import { afterEach, describe, expect, it, vi } from 'vitest'

import app from '../src/app'

const validMetadata: WorkerVersionMetadata = {
  id: 'opaque-cloudflare-version-id',
  tag: '52ef7293615702b399cf5b3bcac7e607f191e51f',
  timestamp: '2026-08-16T00:00:00.000Z',
}

describe('build provenance routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns one validated provenance contract from health, healthz, and config', async () => {
    const env = {
      HONOWARDEN_ENV: 'staging',
      CF_VERSION_METADATA: validMetadata,
    }
    const [health, healthz, config] = await Promise.all([
      app.request('/health', {}, env),
      app.request('/healthz', {}, env),
      app.request('/api/config', {}, env),
    ])

    expect(health.status).toBe(200)
    expect(healthz.status).toBe(200)
    expect(config.status).toBe(200)

    const healthBody = (await health.json()) as {
      build: { gitSha: string; workerVersionId: string; createdAt: string }
    }
    const healthzBody = (await healthz.json()) as typeof healthBody
    const configBody = (await config.json()) as { gitHash: string }

    expect(healthBody).toMatchObject({
      status: 'ok',
      environment: 'staging',
      build: {
        gitSha: validMetadata.tag,
        workerVersionId: validMetadata.id,
        createdAt: validMetadata.timestamp,
      },
    })
    expect(healthzBody.build).toEqual(healthBody.build)
    expect(configBody.gitHash).toBe(healthBody.build.gitSha)
  })

  it.each(['/health', '/healthz', '/api/config', '/config'])(
    'fails closed on %s when a deployable environment cannot prove its source',
    async (path) => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)
      const response = await app.request(
        path,
        { headers: { 'X-Request-Id': 'provenance-failure-request' } },
        { HONOWARDEN_ENV: 'production' },
      )

      expect(response.status).toBe(503)
      await expect(response.json()).resolves.toEqual({
        error: {
          code: 'build_provenance_unavailable',
          message: 'Build provenance is unavailable.',
        },
        requestId: 'provenance-failure-request',
      })
      expect(consoleError).toHaveBeenCalledWith(
        JSON.stringify({
          kind: 'build_provenance_unavailable',
          environment: 'production',
          reason: 'metadata_missing',
          requestId: 'provenance-failure-request',
        }),
      )
    },
  )

  it('keeps local development usable while marking provenance unavailable', async () => {
    const [health, config] = await Promise.all([
      app.request('/health'),
      app.request('/api/config'),
    ])

    expect(health.status).toBe(200)
    expect(config.status).toBe(200)
    await expect(health.json()).resolves.toMatchObject({
      status: 'ok',
      environment: 'development',
      build: null,
      provenanceStatus: 'unavailable',
    })
    await expect(config.json()).resolves.toMatchObject({
      gitHash: 'development',
    })
  })

  it.each(['/health', '/healthz', '/api/config', '/config'])(
    'fails closed on %s without logging an unknown environment value',
    async (path) => {
      const rawEnvironment = 'prod-sensitive-marker'
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)
      const response = await app.request(
        path,
        { headers: { 'X-Request-Id': 'invalid-environment-request' } },
        { HONOWARDEN_ENV: rawEnvironment },
      )

      expect(response.status).toBe(503)
      await expect(response.json()).resolves.toEqual({
        error: {
          code: 'runtime_environment_invalid',
          message: 'Runtime environment is invalid.',
        },
        requestId: 'invalid-environment-request',
      })
      expect(consoleError).toHaveBeenCalledWith(
        JSON.stringify({
          kind: 'build_provenance_unavailable',
          environment: 'invalid',
          reason: 'runtime_environment_invalid',
          requestId: 'invalid-environment-request',
        }),
      )
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
        rawEnvironment,
      )
    },
  )
})
