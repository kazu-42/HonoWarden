import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAccountMailCodec } from '../src/account-lifecycle-mail-envelope'
import { consumeAccountLifecycleMail } from '../src/account-lifecycle-mail-consumer'
import type { OrganizationInvitationSender } from '../src/organization-invitation-mailer'

const now = Date.parse('2026-10-06T00:00:00.000Z')
const key = btoa(String.fromCharCode(7).repeat(32)).replace(/=+$/, '')
const delivery = {
  disposition: 'deliver' as const,
  purpose: 'email_verify' as const,
  recipientEmail: 'Member@example.test',
  token: 's'.repeat(43),
  userId: 'synthetic-user',
  expiresAt: '2026-10-07T00:00:00.000Z',
}
const codec = () =>
  createAccountMailCodec({
    activeKeyId: 'k',
    keysJson: JSON.stringify({ k: key }),
  })
const message = (body: unknown) => ({ body, ack: vi.fn(), retry: vi.fn() })
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('account lifecycle mail consumer', () => {
  it('includes the account reference required by logged-out deletion confirmation only inside the private mail', async () => {
    const envelopeCodec = codec()
    const queued = message(
      await envelopeCodec.seal(
        {
          ...delivery,
          purpose: 'account_delete',
          expiresAt: '2026-10-06T00:15:00.000Z',
        },
        now,
      ),
    )
    const send = vi.fn<OrganizationInvitationSender>(async () => 'accepted')
    await consumeAccountLifecycleMail([queued], {
      codec: envelopeCodec,
      senderEmail: 'accounts@example.test',
      send,
      now: () => now,
    })
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0]![0].text).toContain(
      `Account reference:\n${delivery.userId}`,
    )
    expect(send.mock.calls[0]![0].text).toContain(delivery.token)
    expect(queued.ack).toHaveBeenCalledOnce()
    expect(queued.retry).not.toHaveBeenCalled()
  })

  it.each(['email_verify', 'email_change'] as const)(
    'sends a plain %s code with normalized recipient and no invented handler link',
    async (purpose) => {
      const envelopeCodec = codec()
      const queued = message(
        await envelopeCodec.seal(
          {
            ...delivery,
            purpose,
            expiresAt:
              purpose === 'email_verify'
                ? delivery.expiresAt
                : '2026-10-06T00:15:00.000Z',
          },
          now,
        ),
      )
      const send = vi.fn<OrganizationInvitationSender>(async () => 'accepted')
      await consumeAccountLifecycleMail([queued], {
        codec: envelopeCodec,
        senderEmail: 'accounts@example.test',
        send,
        now: () => now,
      })
      const text = send.mock.calls[0]![0].text
      expect(send.mock.calls[0]![0].to).toBe('member@example.test')
      expect(text).toContain(delivery.token)
      expect(text).not.toMatch(/https?:\/\//)
      expect(text).not.toContain(delivery.userId)
      expect(queued.ack).toHaveBeenCalledOnce()
    },
  )

  it.each(['email_verify', 'email_change', 'account_delete'] as const)(
    'never calls a provider for suppressed %s, even with no provider configuration',
    async (purpose) => {
      const envelopeCodec = codec()
      const queued = message(
        await envelopeCodec.seal(
          {
            ...delivery,
            purpose,
            disposition: 'suppress',
            expiresAt:
              purpose === 'email_verify'
                ? delivery.expiresAt
                : '2026-10-06T00:15:00.000Z',
          },
          now,
        ),
      )
      const send = vi.fn<OrganizationInvitationSender>(async () => {
        throw new Error('Provider must not run')
      })
      await consumeAccountLifecycleMail([queued], {
        codec: envelopeCodec,
        senderEmail: '',
        send,
        now: () => now,
      })
      expect(send).not.toHaveBeenCalled()
      expect(queued.ack).toHaveBeenCalledOnce()
      expect(queued.retry).not.toHaveBeenCalled()
    },
  )

  it('acknowledges an expired delivery without contacting the provider', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const envelopeCodec = codec()
    const queued = message(await envelopeCodec.seal(delivery, now))
    const send = vi.fn<OrganizationInvitationSender>()
    await consumeAccountLifecycleMail([queued], {
      codec: envelopeCodec,
      senderEmail: 'accounts@example.test',
      send,
      now: () => Date.parse(delivery.expiresAt),
    })
    expect(send).not.toHaveBeenCalled()
    expect(queued.ack).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        event: 'account_mail_consumer',
        code: 'message_expired',
      }),
    )
  })

  it('acknowledges structurally malformed poison without forwarding raw contents to a DLQ or log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const send = vi.fn<OrganizationInvitationSender>()
    const queued = message({
      token: delivery.token,
      private: delivery.recipientEmail,
    })
    await consumeAccountLifecycleMail([queued], {
      codec: codec(),
      senderEmail: 'accounts@example.test',
      send,
      now: () => now,
    })
    expect(send).not.toHaveBeenCalled()
    expect(queued.ack).toHaveBeenCalledOnce()
    expect(queued.retry).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        event: 'account_mail_consumer',
        code: 'message_invalid',
      }),
    )
  })

  it.each(['unknown-key', 'wrong-key', 'tampered'] as const)(
    'retries unreadable %s ciphertext for bounded DLQ handling without acknowledging or sending',
    async (reason) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      const envelopeCodec = codec()
      const envelope = await envelopeCodec.seal(delivery, now)
      const openingCodec =
        reason === 'wrong-key'
          ? createAccountMailCodec({
              activeKeyId: 'k',
              keysJson: JSON.stringify({
                k: btoa(String.fromCharCode(9).repeat(32)).replace(/=+$/, ''),
              }),
            })
          : envelopeCodec
      if (reason === 'unknown-key') envelope.keyId = 'missing'
      if (reason === 'tampered')
        envelope.ciphertext =
          (envelope.ciphertext[0] === 'A' ? 'B' : 'A') +
          envelope.ciphertext.slice(1)
      const queued = message(envelope)
      const send = vi.fn<OrganizationInvitationSender>()
      await consumeAccountLifecycleMail([queued], {
        codec: openingCodec,
        senderEmail: 'accounts@example.test',
        send,
        now: () => now,
      })
      expect(send).not.toHaveBeenCalled()
      expect(queued.ack).not.toHaveBeenCalled()
      expect(queued.retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 60 })
      expect(log).toHaveBeenCalledExactlyOnceWith(
        JSON.stringify({
          event: 'account_mail_consumer',
          code: 'message_unreadable',
        }),
      )
    },
  )

  it('retries provider failure once at queue level and continues to acknowledge later suppressed messages', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const envelopeCodec = codec()
    const failed = message(await envelopeCodec.seal(delivery, now))
    const suppressed = message(
      await envelopeCodec.seal({ ...delivery, disposition: 'suppress' }, now),
    )
    const send = vi.fn<OrganizationInvitationSender>(async () => {
      throw new Error(
        `${delivery.token} ${delivery.recipientEmail} private-provider-key`,
      )
    })
    await consumeAccountLifecycleMail([failed, suppressed], {
      codec: envelopeCodec,
      senderEmail: 'accounts@example.test',
      send,
      now: () => now,
    })
    expect(send).toHaveBeenCalledOnce()
    expect(failed.ack).not.toHaveBeenCalled()
    expect(failed.retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 60 })
    expect(suppressed.ack).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        event: 'account_mail_consumer',
        code: 'delivery_failed',
      }),
    )
  })

  it('does not acknowledge an implicit or invalid provider acceptance', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const envelopeCodec = codec()
    const queued = message(await envelopeCodec.seal(delivery, now))
    const send = vi.fn<OrganizationInvitationSender>(
      async () => undefined as unknown as 'accepted',
    )
    await consumeAccountLifecycleMail([queued], {
      codec: envelopeCodec,
      senderEmail: 'accounts@example.test',
      send,
      now: () => now,
    })
    expect(queued.ack).not.toHaveBeenCalled()
    expect(queued.retry).toHaveBeenCalledOnce()
  })

  it('bounds provider work and aborts after ten seconds even if a provider ignores cancellation', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const envelopeCodec = codec()
    const queued = message(await envelopeCodec.seal(delivery, now))
    let started!: () => void, finish!: (value: 'accepted') => void
    const called = new Promise<void>((resolve) => {
      started = resolve
    })
    const send = vi.fn<OrganizationInvitationSender>(async () => {
      started()
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    const consuming = consumeAccountLifecycleMail([queued], {
      codec: envelopeCodec,
      senderEmail: 'accounts@example.test',
      send,
      now: () => now,
    })
    await called
    await vi.advanceTimersByTimeAsync(10_000)
    await consuming
    expect(send.mock.calls[0]![1].aborted).toBe(true)
    expect(queued.ack).not.toHaveBeenCalled()
    expect(queued.retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 60 })
    finish('accepted')
    await Promise.resolve()
    expect(queued.ack).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not send from a future queued timestamp or an invalid clock', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const envelopeCodec = codec()
    const send = vi.fn<OrganizationInvitationSender>()
    for (const clock of [now - 61_000, NaN]) {
      const queued = message(await envelopeCodec.seal(delivery, now))
      await consumeAccountLifecycleMail([queued], {
        codec: envelopeCodec,
        senderEmail: 'accounts@example.test',
        send,
        now: () => clock,
      })
      expect(queued.retry).toHaveBeenCalledOnce()
      expect(queued.ack).not.toHaveBeenCalled()
    }
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects an oversized batch before processing any message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const send = vi.fn<OrganizationInvitationSender>()
    await expect(
      consumeAccountLifecycleMail(
        Array.from({ length: 11 }, () => message(null)),
        {
          codec: codec(),
          senderEmail: 'accounts@example.test',
          send,
          now: () => now,
        },
      ),
    ).rejects.toThrow(/^Account lifecycle mail batch is invalid\.$/)
    expect(send).not.toHaveBeenCalled()
  })
})
