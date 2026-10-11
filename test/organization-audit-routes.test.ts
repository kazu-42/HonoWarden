import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { registerOrganizationAuditRoutes } from '../src/organization-audit-routes'

const now = '2026-10-04T00:00:00.250Z'
const secret = 'synthetic-audit-cursor-secret-at-least-32-bytes'
const actor = {
  userId: 'owner',
  sessionId: 'current-session',
  deviceIdentifier: 'current-device',
}
const event = (id: string) => ({
  allowed: 1,
  id,
  schemaVersion: 1,
  name: 'organization.member.remove',
  outcome: 'success',
  occurredAt: '2026-10-03T00:00:00.000Z',
  actorUserId: 'owner',
  targetType: 'organization_user',
  targetId: 'deleted-member',
})

function fixture(
  input: {
    rows?: ReturnType<typeof event>[]
    enabled?: boolean
    cursorSecret?: string
    optionalLogging?: boolean
    authDenied?: boolean
    databaseError?: Error
  } = {},
) {
  const all = vi.fn(async () => {
    if (input.databaseError) throw input.databaseError
    return { results: input.rows ?? [event('event-id')] }
  })
  const bind = vi.fn(() => ({ all }))
  const prepare = vi.fn(() => ({ bind }))
  const authenticate = vi.fn(async () =>
    input.authDenied
      ? {
          ok: false as const,
          response: new Response(
            JSON.stringify({ error: { code: 'invalid_token' } }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          ),
        }
      : { ok: true as const, actor },
  )
  const reportFailure = vi.fn()
  const app = new Hono()
  registerOrganizationAuditRoutes(app, {
    authenticate,
    runtime: () => ({
      enabled: input.enabled ?? true,
      database: { prepare } as unknown as D1Database,
      cursorSecret: input.cursorSecret ?? secret,
      optionalAuditLoggingEnabled: input.optionalLogging ?? false,
    }),
    now: () => now,
    requestId: () => 'safe-correlation-id',
    reportFailure,
  })
  return { app, prepare, bind, authenticate, reportFailure }
}

describe('organization audit route contract', () => {
  it.each(['', '/export'])(
    'keeps disabled %s read D1/auth-free',
    async (suffix) => {
      const test = fixture({ enabled: false })
      const response = await test.app.request(
        `/api/organizations/org/audit-events${suffix}`,
      )
      expect(response.status).toBe(501)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(await response.json()).toMatchObject({
        error: { code: 'unsupported_feature' },
      })
      expect(test.prepare).not.toHaveBeenCalled()
      expect(test.authenticate).not.toHaveBeenCalled()
    },
  )

  it('preserves authentication refusal before selecting audit data', async () => {
    const test = fixture({ authDenied: true })
    const response = await test.app.request(
      '/api/organizations/org/audit-events',
    )
    expect(response.status).toBe(401)
    expect(test.prepare).not.toHaveBeenCalled()
    expect(test.reportFailure).not.toHaveBeenCalled()
  })

  it('reports missing signing configuration and fails without a D1 query', async () => {
    const test = fixture({ cursorSecret: '' })
    const response = await test.app.request(
      '/api/organizations/org/audit-events',
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      error: { code: 'server_misconfigured' },
    })
    expect(test.reportFailure).toHaveBeenCalledWith(expect.anything(), {
      code: 'server_misconfigured',
      operation: 'query',
    })
    expect(test.prepare).not.toHaveBeenCalled()
  })

  it.each([
    '?limit=101',
    '?limit=1&limit=2',
    '?organizationId=foreign',
    '?outcome=failure',
    '?eventName=cipher.create',
    '?from=2026-10-03&to=2026-10-04',
    '?from=2026-08-01T00%3A00%3A00.000Z',
    '?to=2026-10-05T00%3A00%3A00.000Z',
    '?continuationToken=not-a-valid-cursor',
  ])('rejects invalid query before D1: %s', async (query) => {
    const test = fixture()
    const response = await test.app.request(
      `/api/organizations/org/audit-events${query}`,
    )
    expect(response.status).toBe(400)
    expect(test.prepare).not.toHaveBeenCalled()
  })

  it.each(['?limit=100', '?continuationToken=cursor'])(
    'rejects export pagination: %s',
    async (query) => {
      const test = fixture()
      const response = await test.app.request(
        `/api/organizations/org/audit-events/export${query}`,
      )
      expect(response.status).toBe(400)
      expect(test.prepare).not.toHaveBeenCalled()
    },
  )

  it.each(['', '/export'])(
    'returns an opaque denied scope without history for %s',
    async (suffix) => {
      const test = fixture({ rows: [] })
      const response = await test.app.request(
        `/api/organizations/foreign/audit-events${suffix}`,
      )
      expect(response.status).toBe(404)
      expect(response.headers.get('content-type')).toContain('application/json')
      expect(await response.json()).toEqual({
        error: {
          code: 'organization_not_found',
          message: 'Organization was not found.',
        },
        requestId: 'safe-correlation-id',
      })
    },
  )

  it.each([false, true])(
    'projects redacted history and honest current optional logging state: %s',
    async (optionalLogging) => {
      const test = fixture({
        optionalLogging,
        rows: [{ ...event('event-id'), actorUserId: 'unsafe@example.test' }],
      })
      const response = await test.app.request(
        '/api/organizations/org/audit-events',
      )
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      const body = (await response.json()) as {
        data: unknown[]
        continuationToken: null
        availability: unknown
        query: unknown
      }
      expect(body.data).toEqual([
        {
          object: 'organizationAuditEvent',
          id: 'event-id',
          schemaVersion: 1,
          name: 'organization.member.remove',
          outcome: 'success',
          occurredAt: '2026-10-03T00:00:00.000Z',
          actorUserId: null,
          targetType: 'organization_user',
          targetId: 'deleted-member',
        },
      ])
      expect(body.continuationToken).toBeNull()
      expect(body.query).toEqual({
        from: '2026-09-27T00:00:00.250Z',
        to: now,
        eventName: null,
        actorUserId: null,
        limit: 50,
      })
      expect(body.availability).toMatchObject({
        coverage: 'partial',
        recordedActivity: 'committed_organization_administration',
        persistence: 'required_transactional',
        outcomes: ['success'],
        optionalAuditLoggingEnabled: optionalLogging,
        optionalAuditLoggingHistory: 'unknown',
        retentionDays: 365,
      })
      expect(JSON.stringify(body)).not.toContain('unsafe@example.test')
    },
  )

  it('builds a cursor from the last returned row and restores its fixed bounds', async () => {
    const test = fixture({ rows: [event('event-z'), event('event-a')] })
    const response = await test.app.request(
      '/api/organizations/org/audit-events?limit=1',
    )
    const body = (await response.json()) as {
      data: { id: string }[]
      continuationToken: string
    }
    expect(body.data.map((record) => record.id)).toEqual(['event-z'])
    expect(body.continuationToken).toEqual(expect.any(String))
    const next = await test.app.request(
      `/api/organizations/org/audit-events?continuationToken=${body.continuationToken}`,
    )
    expect(next.status).toBe(200)
    expect(test.bind).toHaveBeenLastCalledWith(
      'owner',
      'current-session',
      'current-device',
      'org',
      'org',
      '2026-09-27T00:00:00.250Z',
      now,
      null,
      null,
      null,
      null,
      '2026-10-03T00:00:00.000Z',
      '2026-10-03T00:00:00.000Z',
      'event-z',
      2,
    )
    const wrongOrg = await test.app.request(
      `/api/organizations/foreign/audit-events?continuationToken=${body.continuationToken}`,
    )
    expect(wrongOrg.status).toBe(400)
  })

  it('returns a complete CSV with controlled file, coverage, and exact row count', async () => {
    const test = fixture()
    const response = await test.app.request(
      '/api/organizations/org/audit-events/export',
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="honowarden-organization-audit.csv"',
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-honowarden-audit-coverage')).toBe(
      'committed-organization-administration;partial',
    )
    expect(response.headers.get('x-honowarden-audit-optional-logging')).toBe(
      'disabled',
    )
    expect(response.headers.get('x-honowarden-audit-from')).toBe(
      '2026-09-27T00:00:00.250Z',
    )
    expect(response.headers.get('x-honowarden-audit-to')).toBe(now)
    expect(response.headers.get('x-honowarden-audit-rows')).toBe('1')
    expect(await response.text()).toBe(
      '"id","occurredAt","name","outcome","actorUserId","targetType","targetId"\r\n' +
        '"event-id","2026-10-03T00:00:00.000Z","organization.member.remove","success","owner","organization_user","deleted-member"\r\n',
    )
    expect(test.bind.mock.calls[0]?.at(-1)).toBe(1001)
  })

  it('refuses CSV overflow before any CSV bytes or download headers', async () => {
    const test = fixture({
      rows: Array.from({ length: 1001 }, (_, index) => event(`event-${index}`)),
    })
    const response = await test.app.request(
      '/api/organizations/org/audit-events/export',
    )
    expect(response.status).toBe(413)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('content-disposition')).toBeNull()
    expect(await response.json()).toMatchObject({
      error: { code: 'audit_export_too_large' },
    })
  })

  it.each(['', '/export'])(
    'reports D1 failure without raw exception/query metadata for %s',
    async (suffix) => {
      const test = fixture({
        databaseError: new Error('synthetic-secret-bearing-SQL'),
      })
      const response = await test.app.request(
        `/api/organizations/org/audit-events${suffix}`,
      )
      expect(response.status).toBe(503)
      const body = await response.json()
      expect(body).toMatchObject({
        error: { code: 'organization_audit_unavailable' },
      })
      expect(JSON.stringify(body)).not.toContain('synthetic-secret-bearing-SQL')
      expect(test.reportFailure).toHaveBeenCalledWith(expect.anything(), {
        code: 'organization_audit_unavailable',
        operation: suffix ? 'export' : 'query',
      })
    },
  )
})
