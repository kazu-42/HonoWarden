import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { registerAdminRoutes } from '../src/admin-routes'

const origin = 'https://vault.example.test'
// This synthetic Base64 value tests header transport, not a signed Chrome trial.
const token = 'AQIDBA=='
const trial = { origin, token }

function fixture(
  options: {
    enabled?: boolean
    emailVerificationTrial?: { origin: string; token: string }
    assets?: Fetcher | null
  } = {},
) {
  const app = new Hono()
  const reportFailure = vi.fn()
  const assets =
    options.assets === undefined
      ? ({
          fetch: vi.fn(async (request: Request) => {
            const path = new URL(request.url).pathname
            const type = path.endsWith('.js')
              ? 'text/javascript'
              : path.endsWith('.css')
                ? 'text/css'
                : path.endsWith('.wasm')
                  ? 'application/wasm'
                  : 'text/html; charset=utf-8'
            return new Response('synthetic asset', {
              headers: {
                'Content-Type': type,
                'Origin-Trial': 'untrusted-upstream-trial',
              },
            })
          }),
        } as unknown as Fetcher)
      : options.assets
  registerAdminRoutes(app, {
    runtime: () => ({
      enabled: options.enabled ?? true,
      ...(assets ? { assets } : {}),
      ...(options.emailVerificationTrial
        ? { emailVerificationTrial: options.emailVerificationTrial }
        : {}),
    }),
    reportFailure,
  })
  app.get('/api/config', (c) => c.json({ api: true }))
  return { app, assets, reportFailure }
}

describe('first-party email verification Origin-Trial document delivery', () => {
  it.each(
    ['/admin/', '/admin/index.html', '/admin/accept/org/member'].flatMap(
      (path) => (['GET', 'HEAD'] as const).map((method) => ({ path, method })),
    ),
  )(
    'adds only the configured token on successful $method $path',
    async ({ path, method }) => {
      const { app, reportFailure } = fixture({ emailVerificationTrial: trial })
      const response = await app.request(`${origin}${path}`, { method })
      expect(response.status).toBe(200)
      expect(response.headers.get('Origin-Trial')).toBe(token)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(response.headers.get('Content-Security-Policy')).toContain(
        "script-src 'self' 'wasm-unsafe-eval'",
      )
      expect(reportFailure).not.toHaveBeenCalled()
      if (method === 'HEAD') expect(await response.text()).toBe('')
    },
  )

  it('accepts the maximum bounded single Base64 value without interpreting it as authority', async () => {
    const bounded = 'A'.repeat(8192)
    const { app } = fixture({
      emailVerificationTrial: { origin, token: bounded },
    })
    const response = await app.request(`${origin}/admin/`)
    expect(response.status).toBe(200)
    expect(response.headers.get('Origin-Trial')).toBe(bounded)
  })

  it('keeps ordinary HTML available and suppresses the upstream token when the trial is absent', async () => {
    const { app, reportFailure } = fixture()
    const response = await app.request(`${origin}/admin/`)
    expect(response.status).toBe(200)
    expect(response.headers.has('Origin-Trial')).toBe(false)
    expect(reportFailure).not.toHaveBeenCalled()
  })

  it.each([
    'https://other.example.test',
    'http://vault.example.test',
    'https://vault.example.test:8443',
  ])(
    'does not deliver a token to the actual origin %s',
    async (requestOrigin) => {
      const { app, reportFailure } = fixture({ emailVerificationTrial: trial })
      const response = await app.request(`${requestOrigin}/admin/`, {
        headers: {
          Origin: origin,
          Host: 'vault.example.test',
          'X-Forwarded-Host': 'vault.example.test',
          'X-Forwarded-Proto': 'https',
          Forwarded: 'host=vault.example.test;proto=https',
        },
      })
      expect(response.status).toBe(200)
      expect(response.headers.has('Origin-Trial')).toBe(false)
      expect(reportFailure).not.toHaveBeenCalled()
    },
  )

  it.each([
    '',
    ' ',
    `${token}\r\nX-Injected: true`,
    `${token}\n`,
    `${token} `,
    `${token},${token}`,
    `Bearer ${token}`,
    'AQID-_==',
    'AAAA=',
    'AB==',
    'A'.repeat(8196),
  ])(
    'rejects malformed or oversized configured token %# with a sanitized diagnostic',
    async (invalid) => {
      const { app, assets, reportFailure } = fixture({
        emailVerificationTrial: { origin, token: invalid },
      })
      const response = await app.request(`${origin}/admin/`)
      expect(response.status).toBe(503)
      expect(response.headers.has('Origin-Trial')).toBe(false)
      expect(await response.text()).toBe(
        'Email verification browser trial configuration unavailable',
      )
      expect(reportFailure).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        'email_verification_trial_configuration',
      )
      expect(assets!.fetch).not.toHaveBeenCalled()
    },
  )

  it.each([
    'http://vault.example.test',
    `${origin}/`,
    `${origin}/path`,
    'https://VAULT.example.test',
    `${origin}:8443`,
  ])(
    'rejects a noncanonical configured RP origin %s',
    async (invalidOrigin) => {
      const { app, reportFailure } = fixture({
        emailVerificationTrial: { origin: invalidOrigin, token },
      })
      const response = await app.request(`${origin}/admin/`)
      expect(response.status).toBe(503)
      expect(response.headers.has('Origin-Trial')).toBe(false)
      expect(reportFailure).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        'email_verification_trial_configuration',
      )
    },
  )

  it.each([
    '/admin/assets/app.js',
    '/admin/assets/app.css',
    '/admin/assets/crypto.wasm',
    '/api/config',
  ])(
    'never attaches a document trial to %s or forwards the upstream trial',
    async (path) => {
      const { app } = fixture({ emailVerificationTrial: trial })
      const response = await app.request(`${origin}${path}`)
      expect(response.status).toBe(200)
      expect(response.headers.has('Origin-Trial')).toBe(false)
    },
  )

  it.each([
    { enabled: false, path: '/admin/', method: 'GET', status: 404 },
    { enabled: true, path: '/admin', method: 'GET', status: 308 },
    { enabled: true, path: '/admin/', method: 'POST', status: 405 },
    { enabled: true, path: '/admin/missing', method: 'GET', status: 404 },
  ])(
    'does not deliver a token for disabled/redirect/invalid responses %#',
    async ({ enabled, path, method, status }) => {
      const { app } = fixture({ enabled, emailVerificationTrial: trial })
      const response = await app.request(`${origin}${path}`, { method })
      expect(response.status).toBe(status)
      expect(response.headers.has('Origin-Trial')).toBe(false)
    },
  )

  it.each([404, 503])(
    'does not attach the token when the static binding returns %s',
    async (status) => {
      const binding = {
        fetch: vi.fn(
          async () =>
            new Response('synthetic failure', {
              status,
              headers: {
                'Content-Type': 'text/html',
                'Origin-Trial': 'untrusted-upstream-trial',
              },
            }),
        ),
      } as unknown as Fetcher
      const { app } = fixture({
        assets: binding,
        emailVerificationTrial: trial,
      })
      const response = await app.request(`${origin}/admin/`)
      expect(response.status).toBe(status)
      expect(response.headers.has('Origin-Trial')).toBe(false)
    },
  )

  it('does not attach the token to incorrectly typed HTML or missing binding errors', async () => {
    const wrongType = {
      fetch: vi.fn(
        async () =>
          new Response('synthetic asset', {
            headers: { 'Content-Type': 'text/javascript' },
          }),
      ),
    } as unknown as Fetcher
    for (const assets of [wrongType, null]) {
      const { app } = fixture({ assets, emailVerificationTrial: trial })
      const response = await app.request(`${origin}/admin/`)
      expect(response.status).toBe(assets === null ? 503 : 404)
      expect(response.headers.has('Origin-Trial')).toBe(false)
    }
  })
})
