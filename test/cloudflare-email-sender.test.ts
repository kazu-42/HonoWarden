import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCloudflareEmailSender } from '../src/cloudflare-email-sender'

const message = {
  from: 'invites@example.test',
  to: 'member@example.test',
  subject: 'HonoWarden organization invitation',
  text: 'Synthetic invitation #token=private-synthetic-token',
}
const error = /^Cloudflare email delivery failed\.$/
afterEach(() => vi.restoreAllMocks())

describe('Cloudflare email sender', () => {
  it('sends one plain-text message and discards the acknowledgement ID', async () => {
    const sendBinding = vi.fn(async () => ({
      messageId: 'private-provider-id',
    }))
    const send = createCloudflareEmailSender({ send: sendBinding })
    await expect(send(message, new AbortController().signal)).resolves.toBe(
      'accepted',
    )
    expect(sendBinding).toHaveBeenCalledExactlyOnceWith(message)
  })

  it.each([
    { ...message, to: 'a@example.test\r\nBcc: other@example.test' },
    { ...message, from: ' INVITES@example.test' },
    { ...message, subject: 'Subject\r\nBcc: other@example.test' },
    { ...message, text: 'x'.repeat(8193) },
  ])('does not send invalid messages', async (invalid) => {
    const sendBinding = vi.fn(async () => ({ messageId: 'id' }))
    await expect(
      createCloudflareEmailSender({ send: sendBinding })(
        invalid,
        new AbortController().signal,
      ),
    ).rejects.toThrow(error)
    expect(sendBinding).not.toHaveBeenCalled()
  })

  it.each([
    undefined,
    null,
    '',
    'x'.repeat(513),
    'id\r\nprivate',
    'id\u0085private',
    42,
    {},
  ])('rejects an invalid acknowledgement %j', async (messageId) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const send = createCloudflareEmailSender({
      send: async () => ({ messageId }),
    } as unknown as SendEmail)
    await expect(send(message, new AbortController().signal)).rejects.toThrow(
      error,
    )
    expect(log).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        event: 'cloudflare_email_send_failed',
        code: 'invalid_ack',
      }),
    )
  })

  it.each([
    [
      Object.assign(new Error(message.text), { code: 'E_RATE_LIMIT_EXCEEDED' }),
      'E_RATE_LIMIT_EXCEEDED',
    ],
    [
      Object.assign(new Error(message.to), { code: 'E_SENDER_NOT_VERIFIED' }),
      'E_SENDER_NOT_VERIFIED',
    ],
    [{ code: 'E_PRIVATE_TOKEN', message: message.text }, 'unknown'],
    [new Error(message.text), 'unknown'],
    [message.text, 'unknown'],
  ] as const)('sanitizes provider failure %j', async (thrown, code) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const send = createCloudflareEmailSender({
      send: async () => {
        throw thrown
      },
    })
    await expect(send(message, new AbortController().signal)).rejects.toThrow(
      error,
    )
    expect(log).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ event: 'cloudflare_email_send_failed', code }),
    )
    expect(JSON.stringify(log.mock.calls)).not.toContain(message.text)
    expect(JSON.stringify(log.mock.calls)).not.toContain(message.to)
  })

  it('refuses a pre-aborted signal without invoking the binding', async () => {
    const sendBinding = vi.fn(async () => ({ messageId: 'id' }))
    const controller = new AbortController()
    controller.abort(new Error(message.text))
    await expect(
      createCloudflareEmailSender({ send: sendBinding })(
        message,
        controller.signal,
      ),
    ).rejects.toThrow(error)
    expect(sendBinding).not.toHaveBeenCalled()
  })

  it('sanitizes a provider error whose code getter itself throws', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const providerError = new Error(message.text)
    Object.defineProperty(providerError, 'code', {
      get() {
        throw new Error(message.to)
      },
    })
    const send = createCloudflareEmailSender({
      send: async () => {
        throw providerError
      },
    })
    await expect(send(message, new AbortController().signal)).rejects.toThrow(
      error,
    )
    expect(log).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        event: 'cloudflare_email_send_failed',
        code: 'unknown',
      }),
    )
  })

  it('aborts during a pending send and treats its outcome as unknown', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const controller = new AbortController()
    const sendBinding = vi.fn(
      () => new Promise<{ messageId: string }>(() => {}),
    )
    const result = createCloudflareEmailSender({ send: sendBinding })(
      message,
      controller.signal,
    )
    const rejection = expect(result).rejects.toThrow(error)
    controller.abort(new Error(message.text))
    await rejection
    expect(sendBinding).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        event: 'cloudflare_email_send_failed',
        code: 'timeout',
      }),
    )
  })

  it('rejects a missing binding at construction', () => {
    expect(() => createCloudflareEmailSender(undefined)).toThrow(
      /configuration is invalid/,
    )
  })
})
