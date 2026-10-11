import { describe, expect, it } from 'vitest'

import app from '../src/app'
import type { Bindings } from '../src/bindings'
import { signAccessToken } from '../src/domain/tokens'

const origin = 'https://vault.example.test'
const env: Partial<Bindings> = {
  HONOWARDEN_ENV: 'development',
  HONOWARDEN_TOKEN_SECRET: 'synthetic-desktop-origin-token-secret',
  HONOWARDEN_DESKTOP_CLIENTS_ENABLED: 'true',
}

describe('explicit Desktop API origin compatibility', () => {
  it.each(['null', 'bw-desktop-file://bundle'])(
    'allows credentialed API reads for the enabled Desktop origin %s',
    async (desktopOrigin) => {
      const response = await app.request(
        `${origin}/api/config`,
        {
          headers: { Origin: desktopOrigin },
        },
        env,
      )
      expect(response.status).toBe(200)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
        desktopOrigin,
      )
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBe(
        'true',
      )
      expect(response.headers.get('Vary')).toContain('Origin')
      const body = (await response.json()) as { object: string }
      expect(body.object).toBe('config')
    },
  )

  it('permits the normal token-request preflight without accepting arbitrary headers', async () => {
    const response = await app.request(
      `${origin}/identity/connect/token`,
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'null',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers':
            'authorization,content-type,device-type',
        },
      },
      env,
    )
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('null')
    const headers = response.headers
      .get('Access-Control-Allow-Headers')!
      .toLowerCase()
      .split(',')
    expect(headers).toEqual(
      expect.arrayContaining(['authorization', 'content-type', 'device-type']),
    )
    expect(headers).not.toContain('cookie')
    expect(headers).not.toContain('*')
  })

  it.each([undefined, 'false', 'TRUE', '1', ' true '])(
    'does not admit opaque Desktop origins without an exact enablement: %s',
    async (value) => {
      const response = await app.request(
        `${origin}/api/config`,
        { headers: { Origin: 'null' } },
        { ...env, HONOWARDEN_DESKTOP_CLIENTS_ENABLED: value },
      )
      expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
    },
  )

  it.each([
    'https://foreign.example.test',
    'file://',
    'bw-desktop-file://foreign',
    'bw-desktop-file://bundle:443',
    'bw-desktop-file://bundle/extra',
    'null https://foreign.example.test',
  ])(
    'rejects unrelated origins even when enabled: %s',
    async (requestOrigin) => {
      const response = await app.request(
        `${origin}/api/config`,
        { headers: { Origin: requestOrigin } },
        env,
      )
      expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
    },
  )

  it.each([
    '/admin/',
    '/health',
    '/api',
    '/identity',
    '/notifications',
    '/apianother/config',
  ])('does not extend opaque-origin access to %s', async (path) => {
    const response = await app.request(
      `${origin}${path}`,
      { headers: { Origin: 'null' } },
      env,
    )
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
  })

  it('does not authenticate a vault request from its origin or a signed token placed in a cookie', async () => {
    const now = Math.floor(Date.now() / 1000)
    const token = await signAccessToken(env.HONOWARDEN_TOKEN_SECRET!, {
      sub: 'synthetic-desktop',
      email: 'desktop@example.test',
      device: 'desktop',
      sessionId: 'session',
      securityStamp: 'stamp',
      iat: now,
      exp: now + 300,
      authMethod: 'refresh',
    })
    const response = await app.request(
      `${origin}/api/sync`,
      {
        headers: {
          Origin: 'null',
          Cookie: `access_token=${token}; authorization=Bearer ${token}`,
        },
      },
      env,
    )
    expect(response.status).toBe(401)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('null')
    expect(JSON.stringify(await response.json())).not.toContain(
      'synthetic-desktop',
    )
  })

  it.each([
    origin,
    'chrome-extension://synthetic',
    'moz-extension://synthetic',
  ])('preserves existing origin behavior: %s', async (requestOrigin) => {
    const response = await app.request(
      `${origin}/api/config`,
      { headers: { Origin: requestOrigin } },
      { HONOWARDEN_ENV: 'development' },
    )
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      requestOrigin,
    )
  })
})
