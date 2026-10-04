import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { registerOrganizationGroupsRoutes } from '../src/organization-groups-routes'

const routes = [
  ['GET', ''],
  ['GET', '/details'],
  ['GET', '/group'],
  ['GET', '/group/details'],
  ['GET', '/group/users'],
  ['POST', ''],
  ['PUT', '/group'],
  ['DELETE', '/group'],
  ['DELETE', '/group/user/member'],
  ['DELETE', ''],
  ['POST', '/delete'],
  ['POST', '/group/delete'],
  ['POST', '/group/delete-user/member'],
  ['POST', '/group'],
] as const

describe('organization group route boundaries', () => {
  it('keeps management default-off including HEAD without auth or database access', async () => {
    const authenticate = vi.fn()
    const prepare = vi.fn()
    const reportFailure = vi.fn()
    const app = new Hono()
    registerOrganizationGroupsRoutes(app, {
      authenticate,
      runtime: () => ({
        enabled: false,
        database: { prepare } as unknown as D1Database,
      }),
      requestId: () => 'group-test',
      reportFailure,
    })
    for (const [method, path] of [...routes, ['HEAD', '/group']] as const) {
      const response = await app.request(
        `/api/organizations/org/groups${path}`,
        { method },
      )
      expect(response.status, `${method} ${path}`).toBe(501)
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
    expect(authenticate).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
    expect(reportFailure).not.toHaveBeenCalled()
  })

  it('refuses deferred aliases before authenticating even with the feature enabled', async () => {
    const authenticate = vi.fn()
    const app = new Hono()
    registerOrganizationGroupsRoutes(app, {
      authenticate,
      runtime: () => ({ enabled: true, database: {} as D1Database }),
      requestId: () => 'group-test',
      reportFailure: vi.fn(),
    })
    for (const [method, path] of routes.slice(9))
      expect(
        (await app.request(`/api/organizations/org/groups${path}`, { method }))
          .status,
      ).toBe(501)
    expect(authenticate).not.toHaveBeenCalled()
  })

  it('bounds body, query and If-Match before database access', async () => {
    const prepare = vi.fn(() => {
      throw new Error('Database must not be used')
    })
    const app = enabledApp({ prepare } as unknown as D1Database)
    for (const [path, body, headers] of [
      ['/group?unexpected=true', {}, {}],
      [
        '/group',
        { name: 'Engineering', collections: [], users: [] },
        { 'if-match': '*' },
      ],
      ['/group', { name: 'x'.repeat(140 * 1024) }, {}],
      ['/group', { name: 'Engineering', collections: [] }, {}],
    ] as const) {
      const response = await app.request(
        `/api/organizations/org/groups${path}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify(body),
        },
      )
      expect(response.status).toBe(400)
    }
    expect(prepare).not.toHaveBeenCalled()
  })

  it('reports sanitized infrastructure failure and request ID', async () => {
    const reportFailure = vi.fn()
    const app = enabledApp(
      {
        prepare() {
          throw new Error('synthetic-private-key')
        },
      } as unknown as D1Database,
      reportFailure,
    )
    const response = await app.request('/api/organizations/org/groups/group')
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('synthetic-private-key')
    expect(reportFailure.mock.calls[0]?.[1]).toEqual({
      code: 'organization_groups_unavailable',
      operation: 'read',
    })
  })
})

function enabledApp(database: D1Database, reportFailure = vi.fn()) {
  const app = new Hono()
  registerOrganizationGroupsRoutes(app, {
    authenticate: async () => ({
      ok: true,
      actor: {
        userId: 'owner',
        sessionId: 'synthetic-session',
        deviceIdentifier: 'synthetic-device',
      },
    }),
    runtime: () => ({ enabled: true, database }),
    requestId: () => 'group-test',
    reportFailure,
  })
  return app
}
