import { afterEach, expect, it, vi } from 'vitest'
import { createAccountMailCodec } from '../src/account-lifecycle-mail-envelope'
import {
  createAccountLifecycleMailReceiver,
  type AccountMailQueue,
} from '../src/account-lifecycle-mail-queue'
import { deliverAccountLifecycleToken } from '../src/account-lifecycle-mailer'

const now = Date.parse('2026-10-06T00:00:00.000Z')
const key = btoa(String.fromCharCode(7).repeat(32)).replace(/=+$/, '')
const receipt: QueueSendResponse = {
  metadata: { metrics: { backlogCount: 1, backlogBytes: 3000 } },
}
const delivery = {
  disposition: 'deliver' as const,
  purpose: 'email_verify' as const,
  recipientEmail: 'member@example.test',
  token: 's'.repeat(43),
  userId: 'synthetic-user',
  expiresAt: '2026-10-07T00:00:00.000Z',
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it.each(['deliver', 'suppress'] as const)(
  'responds202 for %s only after the same encrypted enqueue completes, without a provider call',
  async (disposition) => {
    const codec = createAccountMailCodec({
      activeKeyId: 'k',
      keysJson: JSON.stringify({ k: key }),
    })
    let release!: () => void
    let started!: () => void
    const called = new Promise<void>((resolve) => {
      started = resolve
    })
    const send = vi.fn<AccountMailQueue['send']>(async () => {
      started()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return receipt
    })
    const receiver = createAccountLifecycleMailReceiver({
      codec,
      queue: { send },
      now: () => now,
    })
    const binding = {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        receiver.fetch(new Request(input, init)),
    } as unknown as Fetcher
    let completed = false
    const sending = deliverAccountLifecycleToken(binding, {
      ...delivery,
      disposition,
    }).then(() => {
      completed = true
    })
    await called
    expect(completed).toBe(false)
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0]![1]).toEqual({ contentType: 'json' })
    expect(send.mock.calls[0]![0].ciphertext).toHaveLength(2752)
    expect(await codec.open(send.mock.calls[0]![0])).toEqual({
      status: 'decoded',
      delivery: { ...delivery, disposition },
      queuedAt: new Date(now).toISOString(),
    })
    release()
    await sending
  },
)

it.each(['deliver', 'suppress'] as const)(
  'returns a sanitized failure when %s enqueue fails and never retries locally',
  async (disposition) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const codec = createAccountMailCodec({
      activeKeyId: 'k',
      keysJson: JSON.stringify({ k: key }),
    })
    const send = vi.fn<AccountMailQueue['send']>(async () => {
      throw new Error(`${delivery.token} ${delivery.recipientEmail}`)
    })
    const receiver = createAccountLifecycleMailReceiver({
      codec,
      queue: { send },
      now: () => now,
    })
    const result = await receiver.fetch(request({ ...delivery, disposition }))
    expect(result.status).toBe(503)
    expect(await result.text()).toBe('')
    expect(send).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ event: 'account_mail_enqueue_failed' }),
    )
  },
)

it.each(['deliver', 'suppress'] as const)(
  'bounds the %s enqueue wait at five seconds and treats late acceptance as ambiguous',
  async (disposition) => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const codec = createAccountMailCodec({
      activeKeyId: 'k',
      keysJson: JSON.stringify({ k: key }),
    })
    let started!: () => void, release!: () => void
    const called = new Promise<void>((resolve) => {
      started = resolve
    })
    const send = vi.fn<AccountMailQueue['send']>(async () => {
      started()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return receipt
    })
    const receiver = createAccountLifecycleMailReceiver({
      codec,
      queue: { send },
      now: () => now,
    })
    const result = receiver.fetch(request({ ...delivery, disposition }))
    await called
    await vi.advanceTimersByTimeAsync(5000)
    const response = await result
    expect(response.status).toBe(503)
    release()
    await Promise.resolve()
    expect(response.status).toBe(503)
    expect(send).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  },
)

it('rejects unsupported routes, MIME types, and oversized payloads before enqueue', async () => {
  const codec = createAccountMailCodec({
    activeKeyId: 'k',
    keysJson: JSON.stringify({ k: key }),
  })
  const send = vi.fn<AccountMailQueue['send']>()
  const receiver = createAccountLifecycleMailReceiver({
    codec,
    queue: { send },
    now: () => now,
  })
  expect(
    (
      await receiver.fetch(
        new Request('https://account-lifecycle-mailer.internal/deliver'),
      )
    ).status,
  ).toBe(404)
  expect(
    (await receiver.fetch(request(delivery, '?private=token'))).status,
  ).toBe(404)
  expect(
    (
      await receiver.fetch(
        new Request('https://account-lifecycle-mailer.internal/deliver', {
          method: 'POST',
          body: JSON.stringify(delivery),
        }),
      )
    ).status,
  ).toBe(400)
  expect(
    (await receiver.fetch(request({ ...delivery, token: 'x'.repeat(5000) })))
      .status,
  ).toBe(400)
  expect(send).not.toHaveBeenCalled()
})

function request(value: unknown, suffix = '') {
  return new Request(
    'https://account-lifecycle-mailer.internal/deliver' + suffix,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
    },
  )
}
