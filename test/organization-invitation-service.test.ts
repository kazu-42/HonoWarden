import { afterEach, expect, it, vi } from 'vitest'
import service from '../src/organization-invitation-service'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('fails closed with sanitized telemetry and no fetch when invitation-specific configuration is absent', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const response = await service.fetch(
    new Request('https://organization-membership-mailer.internal/deliver', {
      method: 'POST',
    }),
    {},
  )
  expect(response.status).toBe(503)
  expect(await response.text()).toBe('')
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(fetch).not.toHaveBeenCalled()
  expect(log).toHaveBeenCalledExactlyOnceWith(
    JSON.stringify({ event: 'organization_invitation_configuration_failed' }),
  )
})

it('connects an explicitly configured private receiver to the concrete sender with synthetic provider acceptance', async () => {
  const fetch = vi.fn(async () =>
    Response.json({ id: 'synthetic-provider-id' }),
  )
  vi.stubGlobal('fetch', fetch)
  const response = await service.fetch(
    new Request('https://organization-membership-mailer.internal/deliver', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recipientEmail: 'member@example.test',
        organizationId: 'org',
        membershipId: 'member',
        token: 's'.repeat(43),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    }),
    {
      HONOWARDEN_INVITATION_ADMIN_ORIGIN: 'https://vault.example.test',
      HONOWARDEN_INVITATION_SENDER_EMAIL: 'invites@example.test',
      HONOWARDEN_INVITATION_RESEND_API_KEY: 're_synthetic_invitation_only',
    },
  )
  expect(response.status).toBe(202)
  expect(await response.text()).toBe('')
  expect(fetch).toHaveBeenCalledOnce()
})

it('does not fall back to the separate inquiry mail credential', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const env = {
    HONOWARDEN_INVITATION_ADMIN_ORIGIN: 'https://vault.example.test',
    HONOWARDEN_INVITATION_SENDER_EMAIL: 'invites@example.test',
    HONOWARDEN_RESEND_API_KEY: 're_synthetic_inquiry_only',
  }
  const response = await service.fetch(
    new Request('https://organization-membership-mailer.internal/deliver', {
      method: 'POST',
    }),
    env,
  )
  expect(response.status).toBe(503)
  expect(fetch).not.toHaveBeenCalled()
})
