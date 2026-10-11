import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { registerAdminRoutes } from '../src/admin-routes'
import workerApp from '../src/app'

function fixture(options: { enabled?: boolean; assets?: Fetcher } = {}) {
  const app = new Hono()
  const reportFailure = vi.fn()
  registerAdminRoutes(app, {
    runtime: () => ({
      enabled: options.enabled ?? true,
      assets: options.assets,
    }),
    reportFailure,
  })
  app.get('/api/config', (c) => c.json({ api: true }))
  return { app, reportFailure }
}

function assets(response: Response) {
  return { fetch: vi.fn(async () => response) } as unknown as Fetcher
}

describe('organization administration asset boundary', () => {
  it.each([
    {
      flag: 'true',
      issuers: true,
      origin: 'https://vault.example.com',
      expected: true,
    },
    {
      flag: 'false',
      issuers: true,
      origin: 'https://vault.example.com',
      expected: false,
    },
    {
      flag: 'true',
      issuers: false,
      origin: 'https://vault.example.com',
      expected: false,
    },
    {
      flag: 'true',
      issuers: true,
      origin: 'https://other.example.com',
      expected: false,
    },
  ])(
    'wires trial delivery only for the configured enabled RP: %j',
    async (case_) => {
      const binding = assets(
        new Response('<!doctype html>', {
          headers: { 'Content-Type': 'text/html' },
        }),
      )
      const response = await workerApp.request(
        `${case_.origin}/admin/`,
        {
          headers: {
            Origin: 'https://vault.example.com',
            'X-Forwarded-Host': 'vault.example.com',
            'X-Forwarded-Proto': 'https',
          },
        },
        {
          ADMIN_ASSETS: binding,
          HONOWARDEN_ADMIN_ENABLED: 'true',
          HONOWARDEN_EMAIL_VERIFICATION_ENABLED: case_.flag,
          HONOWARDEN_EMAIL_VERIFICATION_RP_ORIGIN: 'https://vault.example.com',
          HONOWARDEN_EMAIL_VERIFICATION_ISSUERS: JSON.stringify(
            case_.issuers
              ? [
                  {
                    emailDomain: 'example.com',
                    issuer: 'https://issuer.example.com',
                    jwksUri: 'https://issuer.example.com/jwks',
                  },
                ]
              : [],
          ),
          HONOWARDEN_EMAIL_VERIFICATION_ORIGIN_TRIAL_TOKEN: 'AQIDBA==',
        },
      )

      expect(response.status).toBe(200)
      expect(response.headers.get('Origin-Trial')).toBe(
        case_.expected ? 'AQIDBA==' : null,
      )
      expect(binding.fetch).toHaveBeenCalledOnce()
    },
  )

  it('does not fetch assets while the feature is off', async () => {
    const binding = assets(new Response('not served'))
    const { app } = fixture({ enabled: false, assets: binding })
    const response = await app.request('/admin/')
    expect(response.status).toBe(404)
    expect(binding.fetch).not.toHaveBeenCalled()
  })

  it('reports a missing binding as an observable unavailable response', async () => {
    const { app, reportFailure } = fixture()
    const response = await app.request('/admin/')
    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(reportFailure).toHaveBeenCalledOnce()
  })

  it('serves only the built index with browser security headers', async () => {
    const binding = assets(
      new Response('<!doctype html>', {
        headers: { 'Content-Type': 'text/html' },
      }),
    )
    const { app } = fixture({ assets: binding })
    const response = await app.request('/admin/')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    const csp = response.headers.get('Content-Security-Policy')!
    expect(csp).toContain("worker-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("'wasm-unsafe-eval'")
    expect(csp).not.toMatch(/(?:^|\s)'unsafe-(?:inline|eval)'/)
    const request = vi.mocked(binding.fetch).mock.calls[0]![0] as Request
    expect(new URL(request.url).pathname).toBe('/index.html')
    expect(request.headers.has('Authorization')).toBe(false)
  })

  it('serves the invitation navigation route without forwarding its capability', async () => {
    const binding = assets(
      new Response('<!doctype html>', {
        headers: { 'Content-Type': 'text/html' },
      }),
    )
    const { app } = fixture({ assets: binding })
    const response = await app.request(
      '/admin/accept/synthetic-org/synthetic-member',
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
    const request = vi.mocked(binding.fetch).mock.calls[0]![0] as Request
    expect(new URL(request.url).pathname).toBe('/index.html')
  })

  it('does not forward credentials or query capabilities to the asset service', async () => {
    const binding = assets(
      new Response('export {}', {
        headers: { 'Content-Type': 'text/javascript' },
      }),
    )
    const { app } = fixture({ assets: binding })
    expect(
      (
        await app.request('/admin/assets/app-hash.js?capability=synthetic', {
          headers: {
            Authorization: 'Bearer synthetic',
            Cookie: 'synthetic=secret',
          },
        })
      ).status,
    ).toBe(200)
    const request = vi.mocked(binding.fetch).mock.calls[0]![0] as Request
    expect(new URL(request.url).search).toBe('')
    expect([...request.headers]).toEqual([])
  })

  it.each([
    '/admin/missing',
    '/admin/assets/missing.js',
    '/admin/assets/data.json',
  ])('never returns SPA HTML for %s', async (path) => {
    const binding = assets(
      new Response('<html>fallback</html>', {
        headers: { 'Content-Type': 'text/html' },
      }),
    )
    const { app } = fixture({ assets: binding })
    expect((await app.request(path)).status).toBe(404)
  })

  it('preserves missing asset responses without attempting an index fallback', async () => {
    const binding = assets(new Response('missing', { status: 404 }))
    const { app } = fixture({ assets: binding })
    expect((await app.request('/admin/assets/worker-hash.js')).status).toBe(404)
    expect(binding.fetch).toHaveBeenCalledOnce()
  })

  it('does not intercept API routes', async () => {
    const binding = assets(new Response('not served'))
    const { app } = fixture({ assets: binding })
    const response = await app.request('/api/config')
    expect(await response.json()).toEqual({ api: true })
    expect(binding.fetch).not.toHaveBeenCalled()
  })

  it('rejects POST before accessing the binding', async () => {
    const binding = assets(new Response('not served'))
    const { app } = fixture({ assets: binding })
    expect((await app.request('/admin/', { method: 'POST' })).status).toBe(405)
    expect(binding.fetch).not.toHaveBeenCalled()
  })

  it('redacts binding exceptions and reports the failure', async () => {
    const binding = {
      fetch: vi.fn(async () => {
        throw new Error('synthetic-private-detail')
      }),
    } as unknown as Fetcher
    const { app, reportFailure } = fixture({ assets: binding })
    const response = await app.request('/admin/')
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('synthetic-private-detail')
    expect(reportFailure).toHaveBeenCalledOnce()
  })
})
