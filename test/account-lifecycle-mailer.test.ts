import { describe, expect, it, vi } from 'vitest'

import { deliverAccountLifecycleToken } from '../src/account-lifecycle-mailer'

describe('account lifecycle mailer', () => {
  it('sends one bounded internal request and accepts only 202', async () => {
    const token = 't'.repeat(43)
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.method).toBe('POST')
        expect(init?.headers).toEqual({ 'content-type': 'application/json' })
        expect(JSON.parse(String(init?.body))).toEqual({
          disposition: 'deliver',
          purpose: 'email_change',
          recipientEmail: 'next@example.test',
          token,
          userId: 'user-1',
          expiresAt: '2026-08-08T00:15:00.000Z',
        })
        return new Response(null, { status: 202 })
      },
    )

    await expect(
      deliverAccountLifecycleToken({ fetch } as unknown as Fetcher, {
        disposition: 'deliver',
        purpose: 'email_change',
        recipientEmail: 'next@example.test',
        token,
        userId: 'user-1',
        expiresAt: '2026-08-08T00:15:00.000Z',
      }),
    ).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]?.[0]).toBe(
      'https://account-lifecycle-mailer.internal/deliver',
    )
  })

  it('fails loudly without including the token when delivery is rejected', async () => {
    const token = 's'.repeat(43)
    const mailer = {
      fetch: vi.fn(
        async () => new Response('provider detail', { status: 500 }),
      ),
    } as unknown as Fetcher

    await expect(
      deliverAccountLifecycleToken(mailer, {
        disposition: 'deliver',
        purpose: 'account_delete',
        recipientEmail: 'person@example.test',
        token,
        userId: 'user-1',
        expiresAt: '2026-08-08T00:15:00.000Z',
      }),
    ).rejects.toThrow('Account lifecycle token delivery failed.')

    try {
      await deliverAccountLifecycleToken(mailer, {
        disposition: 'deliver',
        purpose: 'account_delete',
        recipientEmail: 'person@example.test',
        token,
        userId: 'user-1',
        expiresAt: '2026-08-08T00:15:00.000Z',
      })
    } catch (error) {
      expect(String(error)).not.toContain(token)
      expect(String(error)).not.toContain('provider detail')
    }
  })
})
