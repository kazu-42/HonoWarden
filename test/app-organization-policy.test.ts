import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { registerOrganizationPolicyRoutes } from '../src/organization-policy-routes'
import type { OrganizationPolicyActor } from '../src/organization-policy'

const repository = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
  impact: vi.fn(),
  update: vi.fn(),
}))

vi.mock('../src/repositories/organization-policy-repository', () => ({
  listOrganizationPolicies: repository.list,
  readOrganizationPolicy: repository.read,
  readOrganizationPolicyImpact: repository.impact,
  updateOrganizationPolicy: repository.update,
}))

const actor: OrganizationPolicyActor = {
  userId: 'owner-a',
  sessionId: 'session-a',
  deviceIdentifier: 'device-a',
}
const policy = {
  id: 'policy-a',
  organizationId: 'org',
  type: 0 as const,
  enabled: true,
  revisionDate: '2026-10-04T00:00:00.000Z',
}
const endpoints = [
  ['GET', '/api/organizations/org/policies', 'list'],
  ['GET', '/api/organizations/org/policies/0', 'read'],
  ['GET', '/api/organizations/org/policies/0/impact', 'impact'],
  ['PUT', '/api/organizations/org/policies/0', 'update'],
] as const
const headEndpoints = [
  ['HEAD', '/api/organizations/org/policies'],
  ['HEAD', '/api/organizations/org/policies/0'],
  ['HEAD', '/api/organizations/org/policies/0/impact'],
] as const

beforeEach(() => {
  for (const mock of Object.values(repository)) mock.mockReset()
  repository.list.mockResolvedValue({ status: 'success', policies: [policy] })
  repository.read.mockResolvedValue({ status: 'success', policy })
  repository.impact.mockResolvedValue({
    status: 'success',
    impact: {
      organizationId: 'org',
      enabled: true,
      policyRevisionDate: policy.revisionDate,
      enrolledOwnerCount: 1,
      noncompliantConfirmedMemberCount: 0,
      noncompliantAcceptedMemberCount: 0,
    },
  })
  repository.update.mockResolvedValue({ status: 'success', policy })
})

describe('organization policy route gates', () => {
  it('stops every disabled route before authentication, D1, or body reads', async () => {
    const harness = testApp(false)
    const bodyReads = vi.fn()
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          bodyReads()
          throw new Error('Disabled writers must not read the request body.')
        },
      },
      { highWaterMark: 0 },
    )

    for (const [method, path] of [...endpoints, ...headEndpoints]) {
      const request = new Request('http://localhost' + path, {
        method,
        ...(method === 'PUT' ? { body, duplex: 'half' } : {}),
      } as RequestInit)
      const response = await harness.app.request(request)

      expect(response.status, method + ' ' + path).toBe(501)
      expect(response.headers.get('cache-control')).toBe('no-store')
      if (method !== 'HEAD') {
        expect(await response.json()).toEqual({
          error: {
            code: 'unsupported_feature',
            message:
              'Organization policy management is unavailable on this server.',
          },
          requestId: 'policy-route-test',
        })
      }
    }

    expect(harness.authenticate).not.toHaveBeenCalled()
    expect(harness.prepare).not.toHaveBeenCalled()
    expect(bodyReads).not.toHaveBeenCalled()
    expect(harness.reportFailure).not.toHaveBeenCalled()
    expectNoRepositoryCalls()
  })

  it.each(endpoints)(
    'passes authentication failure through %s %s',
    async (method, path) => {
      const harness = testApp()
      harness.authenticate.mockResolvedValue({
        ok: false,
        response: new Response('authentication-denied', {
          status: 401,
          headers: { 'WWW-Authenticate': 'Bearer' },
        }),
      })

      const response = await harness.app.request(path, { method })

      expect(response.status).toBe(401)
      expect(await response.text()).toBe('authentication-denied')
      expect(response.headers.get('www-authenticate')).toBe('Bearer')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(harness.prepare).not.toHaveBeenCalled()
      expect(harness.reportFailure).not.toHaveBeenCalled()
      expectNoRepositoryCalls()
    },
  )

  it.each([
    ['GET', '/api/organizations/org/policies/1'],
    ['GET', '/api/organizations/org/policies/2/impact'],
    ['PUT', '/api/organizations/org/policies/10'],
  ] as const)(
    'rejects an unsupported type before the service: %s %s',
    async (method, path) => {
      const harness = testApp()
      const response = await harness.app.request(path, { method })

      await expectError(response, 501, 'unsupported_feature')
      expect(harness.prepare).not.toHaveBeenCalled()
      expectNoRepositoryCalls()
    },
  )

  it.each(endpoints)('rejects query fields on %s %s', async (method, path) => {
    const harness = testApp()
    const response = await harness.app.request(path + '?enabled=true', {
      method,
    })

    await expectError(response, 400, 'invalid_request')
    expect(harness.prepare).not.toHaveBeenCalled()
    expectNoRepositoryCalls()
  })

  it.each(['org.id', 'org%20id', 'org%2Fid', 'org-%E3%81%82', 'o'.repeat(129)])(
    'rejects a malformed organization identifier %#',
    async (organizationId) => {
      const harness = testApp()
      const response = await harness.app.request(
        '/api/organizations/' + organizationId + '/policies/0',
      )

      await expectError(response, 400, 'invalid_request')
      expectNoRepositoryCalls()
    },
  )

  it.each(['-1', '00', '+0', '0.5', 'NaN', '9007199254740992'])(
    'rejects a malformed route policy type %s',
    async (type) => {
      const harness = testApp()
      const response = await harness.app.request(
        '/api/organizations/org/policies/' + type,
      )

      await expectError(response, 400, 'invalid_request')
      expectNoRepositoryCalls()
    },
  )
})

describe('organization policy request bodies', () => {
  it.each([
    undefined,
    '',
    '{',
    'null',
    'true',
    '0',
    '"text"',
    '[]',
    '[{"enabled":true}]',
    '{}',
    '{"enabled":"true"}',
    '{"enabled":true,"unknown":false}',
    '{"enabled":true,"data":[]}',
  ])(
    'rejects malformed or primitive JSON without a repository call %#',
    async (body) => {
      const harness = testApp()
      const response = await harness.app.request(
        '/api/organizations/org/policies/0',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body }),
        },
      )

      await expectError(response, 400, 'invalid_request')
      expect(harness.prepare).not.toHaveBeenCalled()
      expectNoRepositoryCalls()
    },
  )

  it.each([
    '{"enabled":true,"enabled":true}',
    '{"enabled":true,"enabled":false}',
    '{"enabled":true,"Enabled":true}',
    '{"enabled":true,"\\u0065nabled":false}',
    '{"enabled":true,"\\u0045nabled":true}',
    '{"enabled":true,"type":0,"TYPE":0}',
    '{"enabled":true,"type":0,"\\u0074ype":0}',
    '{"enabled":true,"data":null,"Data":{}}',
    '{"enabled":true,"data":{},"\\u0064ata":null}',
  ])(
    'rejects raw duplicate keys after case and escape normalization %#',
    async (body) => {
      const harness = testApp()
      const response = await harness.app.request(
        '/api/organizations/org/policies/0',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body,
        },
      )

      await expectError(response, 400, 'invalid_request')
      expect(harness.prepare).not.toHaveBeenCalled()
      expectNoRepositoryCalls()
    },
  )

  it('accepts an escaped field once without rejecting valid normalization', async () => {
    const harness = testApp()
    const response = await harness.app.request(
      '/api/organizations/org/policies/0',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: '{"\\u0045nabled":true,"Type":0,"Data":{}}',
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(repository.update).toHaveBeenCalledWith(harness.database, {
      organizationId: 'org',
      actor,
      enabled: true,
      now: expect.any(String),
      requestId: 'policy-route-test',
    })
  })

  it.each([
    '{"enabled":true,"type":1}',
    '{"enabled":true,"data":{"unsupportedOption":false}}',
  ])(
    'returns explicit unsupported configuration without mutation %#',
    async (body) => {
      const harness = testApp()
      const response = await harness.app.request(
        '/api/organizations/org/policies/0',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body,
        },
      )

      await expectError(response, 501, 'unsupported_feature')
      expectNoRepositoryCalls()
    },
  )

  it.each(['x'.repeat(5_000), 'あ'.repeat(1_600)])(
    'counts streamed bytes above 4096 without Content-Length %#',
    async (option) => {
      const harness = testApp()
      const bytes = new TextEncoder().encode(
        JSON.stringify({ enabled: true, data: { option } }),
      )
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.subarray(0, 2_048))
          controller.enqueue(bytes.subarray(2_048, 4_096))
          controller.enqueue(bytes.subarray(4_096))
          controller.close()
        },
      })
      const request = new Request(
        'http://localhost/api/organizations/org/policies/0',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body,
          duplex: 'half',
        } as RequestInit,
      )
      expect(request.headers.has('Content-Length')).toBe(false)

      const response = await harness.app.request(request)

      await expectError(response, 400, 'invalid_request')
      expect(harness.prepare).not.toHaveBeenCalled()
      expectNoRepositoryCalls()
    },
  )

  it('accepts a valid JSON body at the exact 4096-byte boundary', async () => {
    const harness = testApp()
    const raw = '{"enabled":true}'
    const response = await harness.app.request(
      '/api/organizations/org/policies/0',
      { method: 'PUT', body: raw.padEnd(4_096, ' ') },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(repository.update).toHaveBeenCalledTimes(1)
  })

  it.each(['4097', '-1', 'not-a-length', '9007199254740992'])(
    'rejects an oversized or malformed Content-Length %s',
    async (contentLength) => {
      const harness = testApp()
      const response = await harness.app.request(
        '/api/organizations/org/policies/0',
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': contentLength,
          },
          body: '{"enabled":true}',
        },
      )

      await expectError(response, 400, 'invalid_request')
      expectNoRepositoryCalls()
    },
  )

  it('rejects invalid UTF-8 without attempting a mutation', async () => {
    const harness = testApp()
    const response = await harness.app.request(
      new Request('http://localhost/api/organizations/org/policies/0', {
        method: 'PUT',
        body: new Uint8Array([0xc3, 0x28]),
      }),
    )

    await expectError(response, 400, 'invalid_request')
    expectNoRepositoryCalls()
  })
})

describe('organization policy route results', () => {
  it.each(endpoints)(
    'returns successful service results on %s %s',
    async (method, path, operation) => {
      const harness = testApp()
      const response = await harness.app.request(path, {
        method,
        ...(method === 'PUT' ? { body: '{"enabled":true}' } : {}),
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(repository[operation]).toHaveBeenCalledTimes(1)
      expect(harness.reportFailure).not.toHaveBeenCalled()
      if (operation === 'list') {
        expect(await response.json()).toMatchObject({
          object: 'list',
          data: [{ Id: 'policy-a', Type: 0, Enabled: true }],
          continuationToken: null,
        })
      } else if (operation === 'impact') {
        expect(await response.json()).toMatchObject({
          Object: 'organizationPolicyImpact',
          organizationId: 'org',
          enrolledOwnerCount: 1,
        })
      } else {
        expect(await response.json()).toEqual({
          Object: 'policy',
          Id: 'policy-a',
          OrganizationId: 'org',
          Type: 0,
          Enabled: true,
          Data: null,
          RevisionDate: policy.revisionDate,
        })
      }
    },
  )

  it.each(endpoints)(
    'obscures unauthorized or unknown organizations on %s %s',
    async (method, path, operation) => {
      const harness = testApp()
      repository[operation].mockResolvedValue({ status: 'not_found' })
      const response = await harness.app.request(path, {
        method,
        ...(method === 'PUT' ? { body: '{"enabled":true}' } : {}),
      })

      await expectError(response, 404, 'organization_not_found')
      expect(harness.reportFailure).not.toHaveBeenCalled()
    },
  )

  it('returns the MFA remediation response for a policy writer', async () => {
    const harness = testApp()
    repository.update.mockResolvedValue({ status: 'mfa_required' })
    const response = await harness.app.request(
      '/api/organizations/org/policies/0',
      {
        method: 'PUT',
        body: '{"enabled":true}',
      },
    )

    await expectError(response, 403, 'organization_mfa_required')
    expect(harness.reportFailure).not.toHaveBeenCalled()
  })

  it.each(endpoints)(
    'reports D1 failure with a redacted 503 on %s %s',
    async (method, path, operation) => {
      const harness = testApp()
      repository[operation].mockImplementation((database: D1Database) =>
        database.prepare('SELECT 1'),
      )
      const response = await harness.app.request(path, {
        method,
        ...(method === 'PUT' ? { body: '{"enabled":true}' } : {}),
      })

      expect(response.status).toBe(503)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toEqual({
        error: {
          code: 'organization_policy_unavailable',
          message: 'Organization policy operation failed.',
        },
        requestId: 'policy-route-test',
      })
      expect(harness.prepare).toHaveBeenCalledTimes(1)
      expect(harness.reportFailure).toHaveBeenCalledTimes(1)
      expect(harness.reportFailure).toHaveBeenCalledWith(expect.anything(), {
        code: 'organization_policy_unavailable',
        operation,
      })
    },
  )
})

function testApp(enabled = true) {
  const prepare = vi.fn(() => {
    throw new Error('private-database-diagnostic')
  })
  const database = { prepare } as unknown as D1Database
  const authenticate = vi.fn(
    async (): Promise<
      | { ok: true; actor: OrganizationPolicyActor }
      | { ok: false; response: Response }
    > => ({ ok: true, actor }),
  )
  const reportFailure = vi.fn()
  const app = new Hono()
  registerOrganizationPolicyRoutes(app, {
    authenticate,
    runtime: () => ({ enabled, database }),
    requestId: () => 'policy-route-test',
    reportFailure,
  })
  return { app, authenticate, database, prepare, reportFailure }
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toMatchObject({
    error: { code },
    requestId: 'policy-route-test',
  })
}

function expectNoRepositoryCalls() {
  for (const mock of Object.values(repository)) {
    expect(mock).not.toHaveBeenCalled()
  }
}
