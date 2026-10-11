import { afterEach, expect, it, vi } from 'vitest'
import service from '../src/account-lifecycle-mail-service'
import {
  createAccountMailCodec,
  type AccountMailEnvelope,
} from '../src/account-lifecycle-mail-envelope'

const env = {
  HONOWARDEN_ACCOUNT_MAIL_ACTIVE_KEY_ID: 'k',
  HONOWARDEN_ACCOUNT_MAIL_ENCRYPTION_KEYS: JSON.stringify({
    k: btoa(String.fromCharCode(7).repeat(32)).replace(/=+$/, ''),
  }),
  HONOWARDEN_ACCOUNT_MAIL_SENDER_EMAIL: 'accounts@example.test',
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it.each(['deliver', 'suppress'] as const)(
  'enqueues %s without a provider key or provider I/O, then only sends eligible queued work',
  async (disposition) => {
    const provider = vi.fn(async () =>
      Response.json({ id: 'synthetic-provider-id' }),
    )
    vi.stubGlobal('fetch', provider)
    const envelopes: AccountMailEnvelope[] = []
    const request = new Request(
      'https://account-lifecycle-mailer.internal/deliver',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          disposition,
          purpose: 'email_verify',
          recipientEmail: 'Member@example.test',
          token: 's'.repeat(43),
          userId: 'synthetic-user',
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }),
      },
    )
    const response = await service.fetch(request, {
      ...env,
      ACCOUNT_LIFECYCLE_DELIVERY_QUEUE: {
        send: async (envelope) => {
          envelopes.push(envelope)
          return {
            metadata: { metrics: { backlogCount: 1, backlogBytes: 3000 } },
          }
        },
      },
    })
    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
    expect(provider).not.toHaveBeenCalled()
    const queued = { body: envelopes[0], ack: vi.fn(), retry: vi.fn() }
    const consumingEnv =
      disposition === 'deliver'
        ? {
            ...env,
            HONOWARDEN_ACCOUNT_MAIL_RESEND_API_KEY:
              're_synthetic_account_mail_only',
          }
        : env
    await service.queue(
      { messages: [queued] } as unknown as MessageBatch,
      consumingEnv,
    )
    expect(provider).toHaveBeenCalledTimes(disposition === 'deliver' ? 1 : 0)
    expect(queued.ack).toHaveBeenCalledOnce()
    expect(queued.retry).not.toHaveBeenCalled()
  },
)

it('uses the same provider idempotency key and body when queue delivery retries after an ambiguous provider failure', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const provider = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new Error('synthetic lost provider response'))
    .mockResolvedValueOnce(Response.json({ id: 'synthetic-provider-id' }))
  vi.stubGlobal('fetch', provider)
  const codec = createAccountMailCodec({
    activeKeyId: env.HONOWARDEN_ACCOUNT_MAIL_ACTIVE_KEY_ID,
    keysJson: env.HONOWARDEN_ACCOUNT_MAIL_ENCRYPTION_KEYS,
  })
  const now = Date.now()
  const envelope = await codec.seal(
    {
      disposition: 'deliver',
      purpose: 'email_verify',
      recipientEmail: 'Member@example.test',
      token: 's'.repeat(43),
      userId: 'synthetic-user',
      expiresAt: new Date(now + 60_000).toISOString(),
    },
    now,
  )
  const queued = { body: envelope, ack: vi.fn(), retry: vi.fn() }
  const consumingEnv = {
    ...env,
    HONOWARDEN_ACCOUNT_MAIL_RESEND_API_KEY: 're_synthetic_account_mail_only',
  }
  await service.queue(
    { messages: [queued] } as unknown as MessageBatch,
    consumingEnv,
  )
  expect(queued.retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 60 })
  expect(queued.ack).not.toHaveBeenCalled()
  await service.queue(
    { messages: [queued] } as unknown as MessageBatch,
    consumingEnv,
  )
  expect(queued.ack).toHaveBeenCalledOnce()
  expect(provider).toHaveBeenCalledTimes(2)
  const first = provider.mock.calls[0]![1]!
  const second = provider.mock.calls[1]![1]!
  const firstKey = new Headers(first.headers).get('idempotency-key')
  expect(firstKey).toMatch(/^honowarden-invitation:[a-f0-9]{64}$/)
  expect(new Headers(second.headers).get('idempotency-key')).toBe(firstKey)
  expect(second.body).toBe(first.body)
})

it('fails closed on producer configuration and leaves invalid consumer configuration for queue retry', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const response = await service.fetch(
    new Request('https://account-lifecycle-mailer.internal/deliver', {
      method: 'POST',
    }),
    {},
  )
  expect(response.status).toBe(503)
  expect(await response.text()).toBe('')
  const queued = { body: null, ack: vi.fn(), retry: vi.fn() }
  await expect(
    service.queue({ messages: [queued] } as unknown as MessageBatch, {}),
  ).rejects.toThrow(
    /^Account lifecycle mail consumer configuration is invalid\.$/,
  )
  expect(queued.ack).not.toHaveBeenCalled()
  expect(log.mock.calls).toEqual([
    [JSON.stringify({ event: 'account_mail_configuration_failed' })],
    [JSON.stringify({ event: 'account_mail_configuration_failed' })],
  ])
})
