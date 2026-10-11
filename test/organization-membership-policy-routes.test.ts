import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerOrganizationMembershipRoutes } from '../src/organization-membership-routes'
import {
  acceptOrganizationMember,
  listOrganizationMembers,
  readOrganizationMember,
  reinviteOrganizationMember,
} from '../src/organization-membership'

vi.mock('../src/organization-membership', async (original) => ({
  ...(await original<typeof import('../src/organization-membership')>()),
  listOrganizationMembers: vi.fn(async () => ({
    status: 'success',
    body: { object: 'list', data: [], continuationToken: null },
  })),
  readOrganizationMember: vi.fn(async () => ({
    status: 'success',
    body: { Object: 'organizationUserDetails', Groups: [] },
  })),
  acceptOrganizationMember: vi.fn(async () => ({ status: 'success' })),
  reinviteOrganizationMember: vi.fn(async () => ({ status: 'rate_limited' })),
}))

const actor = {
  userId: 'member',
  emailNormalized: 'member@example.test',
  sessionId: 'trusted-family',
  deviceIdentifier: 'trusted-device',
}
beforeEach(() => vi.clearAllMocks())

describe('membership trusted actor and group projection route contract', () => {
  it.each([
    ['', listOrganizationMembers],
    ['/membership', readOrganizationMember],
  ] as const)(
    'accepts includeGroups=true and forwards the verified token family on %s',
    async (suffix, operation) => {
      const response = await app().request(
        `/api/organizations/org/users${suffix}?includeGroups=true`,
      )
      expect(response.status).toBe(200)
      expect(vi.mocked(operation).mock.calls[0]?.[1]).toMatchObject({
        actor,
        organizationId: 'org',
        includeGroups: true,
      })
      expect(response.headers.get('cache-control')).toBe('no-store')
    },
  )

  it('uses authenticated caller proof for invitation acceptance', async () => {
    const response = await app().request(
      '/api/organizations/org/users/membership/accept',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'synthetic-token' }),
      },
    )
    expect(response.status).toBe(200)
    expect(
      vi.mocked(acceptOrganizationMember).mock.calls[0]?.[1],
    ).toMatchObject({
      actor,
      organizationId: 'org',
      membershipId: 'membership',
    })
  })

  it('returns a fixed 429 for a refused reinvitation', async () => {
    const response = await app().request(
      '/api/organizations/org/users/membership/reinvite',
      { method: 'POST' },
    )
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({
      error: { code: 'invitation_rate_limited' },
    })
    expect(reinviteOrganizationMember).toHaveBeenCalledOnce()
  })
})

function app() {
  const application = new Hono()
  registerOrganizationMembershipRoutes(application, {
    authenticate: async () => ({ ok: true, actor }),
    runtime: () => ({
      enabled: true,
      database: {} as D1Database,
      inviteSecret: 'synthetic-organization-invite-secret',
      delivery: vi.fn(async () => {}),
    }),
    requestId: () => 'membership-proof-test',
    reportFailure: vi.fn(),
  })
  return application
}
