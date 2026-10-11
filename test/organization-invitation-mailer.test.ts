import { afterEach, describe, expect, it, vi } from 'vitest'

import { createOrganizationMembershipMailerDelivery } from '../src/organization-membership'
import {
  createOrganizationInvitationMailer,
  type OrganizationInvitationSender,
} from '../src/organization-invitation-mailer'

const now = '2026-10-06T00:00:00.000Z'
const token = 's'.repeat(43)
const delivery = {
  recipientEmail: 'member@example.test',
  organizationId: 'org',
  membershipId: 'member',
  token,
  expiresAt: '2026-10-11T00:00:00.000Z',
}
const address = 'https://organization-membership-mailer.internal/deliver'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function fixture() {
  const send = vi.fn<OrganizationInvitationSender>(async () => 'accepted')
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const mailer = createOrganizationInvitationMailer({
    adminOrigin: 'https://vault.example.test',
    senderEmail: 'invites@example.test',
    send,
    now: () => Date.parse(now),
  })
  return { send, log, mailer }
}

function request(body: unknown = delivery, url = address): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('organization invitation mailer service', () => {
  it('sends only a fixed permission-free test template to the validated saved recipient', async () => {
    const { mailer, send } = fixture()
    const response = await mailer.fetch(
      request(
        {
          recipientEmail: delivery.recipientEmail,
          testId: crypto.randomUUID(),
        },
        'https://organization-membership-mailer.internal/test',
      ),
    )
    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0]![0]).toMatchObject({
      to: delivery.recipientEmail,
      subject: 'HonoWarden delivery test',
    })
    expect(send.mock.calls[0]![0].text).not.toMatch(/https:|token=|password/)
  })
  it('constructs distinct test messages without invitation tokens', async () => {
    const send = vi.fn<OrganizationInvitationSender>(async () => 'accepted')
    const mailer = createOrganizationInvitationMailer({
      adminOrigin: 'https://vault.example.test',
      senderEmail: 'invites@example.test',
      send,
    })
    const first = {
      recipientEmail: delivery.recipientEmail,
      testId: crypto.randomUUID(),
    }
    for (const body of [
      first,
      first,
      { ...first, testId: crypto.randomUUID() },
    ]) {
      expect(
        (
          await mailer.fetch(
            request(
              body,
              'https://organization-membership-mailer.internal/test',
            ),
          )
        ).status,
      ).toBe(202)
    }
    expect(send.mock.calls[0]![0].text).toBe(send.mock.calls[1]![0].text)
    expect(send.mock.calls[2]![0].text).not.toBe(send.mock.calls[0]![0].text)
  })
  it.each([
    null,
    {},
    { recipientEmail: delivery.recipientEmail, testId: 'caller supplied text' },
    { recipientEmail: 'x\r\n@example.test' },
    { recipientEmail: 'Member@example.test' },
    { recipientEmail: delivery.recipientEmail, text: 'caller supplied text' },
    delivery,
  ])(
    'rejects invalid test-mail input without a provider call',
    async (body) => {
      const { mailer, send } = fixture()
      expect(
        (
          await mailer.fetch(
            request(
              body,
              'https://organization-membership-mailer.internal/test',
            ),
          )
        ).status,
      ).toBe(400)
      expect(send).not.toHaveBeenCalled()
    },
  )
  it('connects the existing internal adapter to an acknowledged provider using the admin fragment contract', async () => {
    const { mailer, send, log } = fixture()
    const binding = {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        mailer.fetch(new Request(input, init)),
    } as unknown as Fetcher
    await expect(
      createOrganizationMembershipMailerDelivery(binding)(delivery),
    ).resolves.toBeUndefined()
    expect(send).toHaveBeenCalledOnce()
    const message = send.mock.calls[0]![0]
    expect(message).toEqual({
      from: 'invites@example.test',
      to: 'member@example.test',
      subject: 'HonoWarden organization invitation',
      text: expect.any(String),
    })
    const link = new URL(message.text.match(/https:\/\/\S+/)![0])
    expect(link.origin).toBe('https://vault.example.test')
    expect(link.pathname).toBe('/admin/accept/org/member')
    expect(link.search).toBe('')
    expect(link.hash).toBe(`#token=${token}`)
    expect([...new URLSearchParams(link.hash.slice(1)).entries()]).toEqual([
      ['token', token],
    ])
    expect(message.text).toContain(delivery.expiresAt)
    expect(log).not.toHaveBeenCalled()
  })

  it('returns no payload or token in the acknowledgement', async () => {
    const { mailer } = fixture()
    const response = await mailer.fetch(request())
    expect(response.status).toBe(202)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe('')
  })

  it.each([
    null,
    [],
    {},
    { ...delivery, unexpected: 'field' },
    { ...delivery, token: undefined },
    { ...delivery, token: 'z'.repeat(43) },
    { ...delivery, token: 's'.repeat(42) },
    { ...delivery, organizationId: '../org' },
    { ...delivery, membershipId: 'member#token=other' },
    { ...delivery, membershipId: 'x'.repeat(129) },
    { ...delivery, recipientEmail: 'Member@example.test' },
    { ...delivery, recipientEmail: ' member@example.test' },
    {
      ...delivery,
      recipientEmail: 'member@example.test\r\nBcc: other@example.test',
    },
    { ...delivery, recipientEmail: 'x'.repeat(250) + '@example.test' },
    { ...delivery, expiresAt: now },
    { ...delivery, expiresAt: '2026-10-05T00:00:00.000Z' },
    { ...delivery, expiresAt: '2026-10-11T00:00:00Z' },
    { ...delivery, expiresAt: '2026-02-30T00:00:00.000Z' },
    { ...delivery, expiresAt: 'invalid' },
  ])(
    'rejects malformed or expired delivery %j before sending',
    async (body) => {
      const { mailer, send, log } = fixture()
      const response = await mailer.fetch(request(body))
      expect(response.status).toBe(400)
      expect(await response.text()).toBe('')
      expect(send).not.toHaveBeenCalled()
      expect(log).not.toHaveBeenCalled()
    },
  )

  it.each([
    'http://vault.example.test',
    'https://vault.example.test/',
    'https://vault.example.test/admin',
    'https://vault.example.test?redirect=other',
    'https://user:password@vault.example.test',
    'https://vault.example.test#token=other',
    'https://VAULT.example.test',
    'not a URL',
  ])('refuses a noncanonical HTTPS admin origin %s', (adminOrigin) => {
    expect(() =>
      createOrganizationInvitationMailer({
        adminOrigin,
        senderEmail: 'invites@example.test',
        send: vi.fn(),
      }),
    ).toThrow('Organization invitation mailer configuration is invalid.')
  })

  it('rejects header injection in the configured sender', () => {
    expect(() =>
      createOrganizationInvitationMailer({
        adminOrigin: 'https://vault.example.test',
        senderEmail: 'invites@example.test\r\nBcc: other@example.test',
        send: vi.fn(),
      }),
    ).toThrow('Organization invitation mailer configuration is invalid.')
  })

  it.each([
    'https://untrusted.example.test/deliver',
    `${address}?token=${token}`,
    `${address}/extra`,
  ])('rejects unsupported destinations without sending %s', async (url) => {
    const { mailer, send } = fixture()
    expect((await mailer.fetch(request(delivery, url))).status).toBe(404)
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects GET and non-JSON requests', async () => {
    const { mailer, send } = fixture()
    expect((await mailer.fetch(new Request(address))).status).toBe(404)
    expect(
      (
        await mailer.fetch(
          new Request(address, {
            method: 'POST',
            body: JSON.stringify(delivery),
          }),
        )
      ).status,
    ).toBe(400)
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects oversized bodies with or without declared Content-Length', async () => {
    const { mailer, send } = fixture()
    for (const headers of [
      { 'content-type': 'application/json' },
      { 'content-type': 'application/json', 'content-length': '5000' },
    ]) {
      const response = await mailer.fetch(
        new Request(address, {
          method: 'POST',
          headers,
          body: ' '.repeat(5000),
        }),
      )
      expect(response.status).toBe(400)
    }
    expect(send).not.toHaveBeenCalled()
  })

  it.each(['{', '{"token":"private"}', '\ufeffnot-json'])(
    'rejects malformed JSON without exposing it',
    async (body) => {
      const { mailer, send } = fixture()
      const response = await mailer.fetch(
        new Request(address, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        }),
      )
      expect(response.status).toBe(400)
      expect(await response.text()).toBe('')
      expect(send).not.toHaveBeenCalled()
    },
  )

  it.each([true, false])(
    'sanitizes synchronous=%s provider failure and never automatically retries',
    async (synchronous) => {
      const { mailer, send, log } = fixture()
      const privateError = new Error(
        `${delivery.recipientEmail} ${token} provider API key`,
      )
      send.mockImplementation(() => {
        if (synchronous) throw privateError
        return Promise.reject(privateError)
      })
      const response = await mailer.fetch(request())
      expect(response.status).toBe(503)
      expect(await response.text()).toBe('')
      expect(send).toHaveBeenCalledOnce()
      expect(log).toHaveBeenCalledExactlyOnceWith(
        JSON.stringify({
          event: 'organization_invitation_delivery_failed',
          code: 'delivery_failed',
        }),
      )
    },
  )

  it('requires an explicit accepted outcome from the sender', async () => {
    const { mailer, send, log } = fixture()
    send.mockResolvedValue(undefined as unknown as 'accepted')
    expect((await mailer.fetch(request())).status).toBe(503)
    expect(log).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        event: 'organization_invitation_delivery_failed',
        code: 'delivery_rejected',
      }),
    )
    expect(send).toHaveBeenCalledOnce()
  })

  it('aborts a stalled sender after ten seconds and ignores late acceptance', async () => {
    vi.useFakeTimers()
    const { mailer, send, log } = fixture()
    let started!: () => void
    const sending = new Promise<void>((resolve) => {
      started = resolve
    })
    let accepted!: (value: 'accepted') => void
    send.mockImplementation(() => {
      started()
      return new Promise((resolve) => {
        accepted = resolve
      })
    })
    const responsePromise = mailer.fetch(request())
    await sending
    await vi.advanceTimersByTimeAsync(10_000)
    const response = await responsePromise
    expect(response.status).toBe(503)
    expect(send.mock.calls[0]![1].aborted).toBe(true)
    expect(send).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        event: 'organization_invitation_delivery_failed',
        code: 'delivery_timeout',
      }),
    )
    accepted('accepted')
    await Promise.resolve()
    expect(response.status).toBe(503)
    expect(vi.getTimerCount()).toBe(0)
  })
})
